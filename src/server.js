import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRobotStore } from './state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const FIRMWARE_DIR = path.join(ROOT_DIR, 'firmware');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ino': 'text/plain; charset=utf-8',
  '.h': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 64 * 1024) {
      throw new Error('Request payload too large');
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

export function createAppServer() {
  const store = createRobotStore();
  const sseClients = new Set();

  store.emitter.on('update', (snapshot) => {
    const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
    for (const res of sseClients) {
      res.write(payload);
    }
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    try {
      if (req.method === 'GET' && pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, status: 'online' });
      }

      if (req.method === 'GET' && pathname === '/api/state') {
        return sendJson(res, 200, store.getPublicState());
      }

      if (req.method === 'GET' && pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(`data: ${JSON.stringify(store.getPublicState())}\n\n`);
        sseClients.add(res);
        const keepAlive = setInterval(() => {
          res.write(': ping\n\n');
        }, 15000);
        req.on('close', () => {
          clearInterval(keepAlive);
          sseClients.delete(res);
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/telemetry') {
        const body = await readJsonBody(req);
        const updated = store.applyTelemetry(body);
        return sendJson(res, 200, updated);
      }

      if (req.method === 'POST' && pathname === '/api/command') {
        const body = await readJsonBody(req);
        if (!body.action) {
          return sendJson(res, 400, { error: 'Missing required field: action' });
        }
        const updated = store.handleCommand(body.action, body.params || {});
        return sendJson(res, 200, updated);
      }

      if (req.method === 'POST' && pathname === '/api/schedules') {
        const body = await readJsonBody(req);
        const updated = store.updateSchedules(body.schedules);
        return sendJson(res, 200, updated);
      }

      if (req.method === 'POST' && pathname === '/api/notifications/clear') {
        const updated = store.clearNotifications();
        return sendJson(res, 200, updated);
      }

      if (req.method === 'POST' && pathname === '/api/notifications/test') {
        const body = await readJsonBody(req);
        const entry = store.addNotification({
          type: body.type || 'info',
          title: body.title || 'Caretaker Test Alert',
          message: body.message || 'Caretaker notification channel verified successfully.',
          channel: 'Caretaker Alert Service',
        });
        store.emitter.emit('update', store.getPublicState());
        return sendJson(res, 200, { ok: true, notification: entry });
      }

      if (req.method === 'POST' && pathname === '/api/contact') {
        const body = await readJsonBody(req);
        const saved = store.addContactMessage(body);
        return sendJson(res, 201, { ok: true, entry: saved });
      }

      if (req.method === 'GET' && pathname.startsWith('/firmware/')) {
        const relPath = pathname.replace(/^\/firmware\//, '');
        const resolved = path.resolve(FIRMWARE_DIR, relPath);
        if (!resolved.startsWith(FIRMWARE_DIR + path.sep)) {
          return sendJson(res, 403, { error: 'Forbidden' });
        }
        const content = await fs.readFile(resolved);
        const ext = path.extname(resolved).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain; charset=utf-8' });
        return res.end(content);
      }

      if (req.method === 'GET') {
        const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
        const resolved = path.resolve(PUBLIC_DIR, requested);
        if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== PUBLIC_DIR) {
          return sendJson(res, 403, { error: 'Forbidden' });
        }
        try {
          const stat = await fs.stat(resolved);
          if (stat.isFile()) {
            const content = await fs.readFile(resolved);
            const ext = path.extname(resolved).toLowerCase();
            res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
            return res.end(content);
          }
        } catch {
          // Fallback to index.html for unknown client routes without extensions
          if (!path.extname(requested)) {
            const indexHtml = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'));
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(indexHtml);
          }
        }
      }

      return sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const status = err instanceof SyntaxError || /required|invalid|unknown/i.test(err.message) ? 400 : 500;
      return sendJson(res, status, { error: err.message });
    }
  });

  return { server, store };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  const { server } = createAppServer();
  server.listen(port, () => {
    console.log(`Automatic Medicine Delivery Robot server listening on http://localhost:${port}`);
  });
}
