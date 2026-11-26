import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../src/server.js';

describe('Automatic Medicine Delivery Robot API & State Machine', () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = createAppServer();
    server = app.server;
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('serves health check and initial dashboard state', async () => {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.ok, true);

    const stateRes = await fetch(`${baseUrl}/api/state`);
    assert.equal(stateRes.status, 200);
    const state = await stateRes.json();
    assert.equal(state.servos.compartments.length, 3);
    assert.equal(state.faceMatchSignal, 0);
    assert.equal(state.medicineStatus, 'Pending');
    assert.ok(state.currentTime);
    assert.ok(typeof state.batteryPercent === 'number');
  });

  it('blocks medicine dispensing when AI face match signal is 0 (safety interlock)', async () => {
    await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset_compartments' }),
    });

    const res = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dispense_compartment', params: { compartmentId: 2 } }),
    });
    const state = await res.json();
    assert.equal(state.medicineStatus, 'Pending');
    assert.equal(state.servos.compartments[1].status, 'Pending');
    assert.match(state.notifications[0].title, /Safety Interlock/i);
  });

  it('executes full autonomous delivery cycle when face match = 1', async () => {
    const startRes = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start_delivery', params: { compartmentId: 3 } }),
    });
    const started = await startRes.json();
    assert.equal(started.robotStatus, 'Moving');
    assert.equal(started.activeStep, 2);

    const obsRes = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trigger_obstacle', params: { distanceCm: 16 } }),
    });
    const obstacle = await obsRes.json();
    assert.equal(obstacle.obstacleStatus, 'Obstacle Detected');
    assert.equal(obstacle.obstacleDistanceCm, 16);

    const matchRes = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_face_match', params: { match: 1 } }),
    });
    const matched = await matchRes.json();
    assert.equal(matched.faceMatchSignal, 1);
    assert.equal(matched.patientStatus, 'Detected');
    assert.equal(matched.robotStatus, 'Patient Found');

    const dispRes = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dispense_compartment', params: { compartmentId: 3 } }),
    });
    const delivered = await dispRes.json();
    assert.equal(delivered.medicineStatus, 'Dispensed');
    assert.equal(delivered.robotStatus, 'Medicine Delivered');
    assert.equal(delivered.servos.compartments[2].angle, 90);
    assert.equal(delivered.servos.compartments[2].status, 'Dispensed');
    assert.equal(delivered.activeStep, 7);
  });

  it('ingests hardware telemetry and updates RTC schedules and contact messages', async () => {
    const telRes = await fetch(`${baseUrl}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'hardware',
        obstacleDistanceCm: 12,
        batteryPercent: 88,
        batteryVoltage: 11.6,
      }),
    });
    const tel = await telRes.json();
    assert.equal(tel.mode, 'hardware');
    assert.equal(tel.obstacleStatus, 'Obstacle Detected');
    assert.equal(tel.batteryPercent, 88);

    const schedRes = await fetch(`${baseUrl}/api/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schedules: [{ id: 1, time: '07:30 AM', medicine: 'Aspirin 75mg' }],
      }),
    });
    const sched = await schedRes.json();
    assert.equal(sched.servos.compartments[0].time, '07:30 AM');
    assert.equal(sched.servos.compartments[0].medicine, 'Aspirin 75mg');

    const contactRes = await fetch(`${baseUrl}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Nurse Priya',
        email: 'priya@clinic.org',
        message: 'Confirming compartment 1 schedule.',
      }),
    });
    assert.equal(contactRes.status, 201);
  });

  it('serves static website and firmware files', async () => {
    const homeRes = await fetch(`${baseUrl}/`);
    assert.equal(homeRes.status, 200);
    const html = await homeRes.text();
    assert.match(html, /Smart Medicine Delivery for Safer Patient Care/);

    const fwRes = await fetch(`${baseUrl}/firmware/WIRING_GUIDE.md`);
    assert.equal(fwRes.status, 200);
    const md = await fwRes.text();
    assert.match(md, /ESP8266 Board 1/);
  });
});
