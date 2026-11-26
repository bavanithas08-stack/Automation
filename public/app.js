import { RobotArenaSimulator } from './simulator.js';

const STEP_NAMES = [
  'Schedule',
  'Start',
  'Search',
  'AI Verification',
  'Patient Found',
  'Medicine Delivery',
  'Completion',
];

let latestState = null;

async function apiPost(url, payload = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

function sendCommand(action, params = {}) {
  return apiPost('/api/command', { action, params });
}

function sendTelemetry(payload) {
  return apiPost('/api/telemetry', payload);
}

function renderState(state) {
  latestState = state;

  // Live Dashboard KPIs
  document.getElementById('dashTime').textContent = state.currentTime;
  document.getElementById('dashRobotStatus').textContent = state.robotStatus;
  document.getElementById('dashStepText').textContent = `Step ${state.activeStep}: ${STEP_NAMES[state.activeStep - 1] || ''}`;
  document.getElementById('dashPatientStatus').textContent = state.patientStatus;
  document.getElementById('dashFaceSignal').textContent = `AI Signal: ${state.faceMatchSignal} (${state.faceMatchSignal === 1 ? 'Match' : 'No Match'})`;
  document.getElementById('dashMedicineStatus').textContent = state.medicineStatus;
  document.getElementById('dashActiveComp').textContent = `Compartment #${state.activeCompartment}`;
  document.getElementById('dashObstacleStatus').textContent = state.obstacleStatus;
  document.getElementById('dashDistance').textContent = `${state.obstacleDistanceCm} cm ahead`;
  document.getElementById('dashBattery').textContent = `${state.batteryPercent}% / ${state.batteryVoltage}V`;

  // Hero telemetry card
  document.getElementById('heroRobotStatus').textContent = state.robotStatus;
  document.getElementById('heroFaceMatch').textContent = `${state.faceMatchSignal} (${state.faceMatchSignal === 1 ? 'Match' : 'No Match'})`;
  document.getElementById('heroObstacle').textContent = `${state.obstacleStatus} (${state.obstacleDistanceCm} cm)`;
  document.getElementById('heroBattery').textContent = `${state.batteryPercent}% (${state.batteryVoltage}V)`;

  // 7-step How It Works
  document.querySelectorAll('.step-card').forEach((card) => {
    const step = Number(card.dataset.step);
    card.classList.toggle('active', step === state.activeStep);
    card.classList.toggle('completed', step < state.activeStep);
  });

  // AI System section
  const isMatch = state.faceMatchSignal === 1;
  const badge = document.getElementById('aiSignalBadge');
  badge.textContent = `Signal: ${state.faceMatchSignal} (${isMatch ? 'Match' : 'No Match'})`;
  badge.classList.toggle('match', isMatch);

  document.getElementById('faceReticle').classList.toggle('matched', isMatch);
  document.getElementById('reticleLabel').textContent = isMatch
    ? `Verified: ${state.patientProfile.name}`
    : 'Scanning for Registered Face...';
  document.getElementById('aiBinaryCode').textContent = String(state.faceMatchSignal);
  document.getElementById('aiConfidence').textContent = `${Number(state.patientProfile.confidence || 0).toFixed(1)}%`;
  document.getElementById('aiCamAngle').textContent = `Pan Servo: ${state.servos.cameraPan}°`;
  document.getElementById('cameraPanSlider').value = state.servos.cameraPan;
  document.getElementById('cameraPanValue').textContent = `${state.servos.cameraPan}°`;

  // Simulator telemetry card
  document.getElementById('simLeftMotor').textContent = `${state.motors.leftDirection} (${state.motors.speed})`;
  document.getElementById('simRightMotor').textContent = `${state.motors.rightDirection} (${state.motors.speed})`;
  document.getElementById('simUsPan').textContent = `${state.servos.ultrasonicPan}°`;
  document.getElementById('simUsTilt').textContent = `${state.servos.ultrasonicTilt}°`;
  document.getElementById('simDistance').textContent = `${state.obstacleDistanceCm} cm`;
  document.getElementById('simPathStatus').textContent = state.obstacleStatus;

  // Hardware LCD & Buzzer
  document.getElementById('lcdLine1').textContent = state.lcd.line1;
  document.getElementById('lcdLine2').textContent = state.lcd.line2;
  const buzzerEl = document.getElementById('buzzerStatus');
  buzzerEl.textContent = state.buzzerActive ? 'ALERTING (Active)' : 'Silent';
  buzzerEl.classList.toggle('active', state.buzzerActive);

  // Compartments grid
  renderCompartments(state);

  // Notifications
  renderNotifications(state.notifications || []);
}

function renderCompartments(state) {
  const container = document.getElementById('compartmentsGrid');
  // Preserve focus if user is currently editing an input inside compartmentsGrid
  if (container.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') {
    return;
  }

  container.innerHTML = '';
  for (const comp of state.servos.compartments) {
    const box = document.createElement('div');
    box.className = `comp-box ${comp.status === 'Dispensed' ? 'dispensed' : ''}`;
    box.innerHTML = `
      <div class="comp-top">
        <strong>Compartment #${comp.id}</strong>
        <span class="tag ${comp.status === 'Dispensed' ? 'tag-teal' : ''}">${comp.status}</span>
      </div>
      <small>${comp.label} &bull; Servo: ${comp.angle}&deg;</small>
      <input type="text" data-comp-id="${comp.id}" data-field="medicine" value="${escapeHtml(comp.medicine)}" aria-label="Compartment ${comp.id} medicine" />
      <input type="text" data-comp-id="${comp.id}" data-field="time" value="${escapeHtml(comp.time)}" aria-label="Compartment ${comp.id} scheduled time" />
      <button class="btn btn-secondary btn-sm" data-dispense="${comp.id}">Open Servo #${comp.id}</button>
    `;
    container.appendChild(box);
  }

  container.querySelectorAll('[data-dispense]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.dispense);
      sendCommand('dispense_compartment', { compartmentId: id });
    });
  });
}

function renderNotifications(notifications) {
  const list = document.getElementById('notifList');
  document.getElementById('notifCount').textContent = String(notifications.length);
  list.innerHTML = '';

  if (notifications.length === 0) {
    list.innerHTML = '<li class="notif-item"><div><strong>No notifications</strong><p>System events will appear here.</p></div></li>';
    return;
  }

  for (const item of notifications) {
    const li = document.createElement('li');
    li.className = `notif-item ${item.type || 'info'}`;
    const timeStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.message)}</p>
      </div>
      <div class="notif-meta">
        <div>${escapeHtml(timeStr)}</div>
        <div>${escapeHtml(item.channel || '')}</div>
      </div>
    `;
    list.appendChild(li);
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function initSSE() {
  const pill = document.getElementById('sseStatus');
  const text = document.getElementById('sseStatusText');
  const evtSource = new EventSource('/api/events');

  evtSource.onopen = () => {
    pill.classList.add('connected');
    text.textContent = 'Live Telemetry Connected';
  };

  evtSource.onmessage = (event) => {
    try {
      const state = JSON.parse(event.data);
      renderState(state);
    } catch {
      // ignore malformed keepalive
    }
  };

  evtSource.onerror = () => {
    pill.classList.remove('connected');
    text.textContent = 'Reconnecting...';
  };
}

function initUI() {
  // Mobile nav toggle
  const navToggle = document.getElementById('navToggle');
  const siteNav = document.getElementById('siteNav');
  navToggle.addEventListener('click', () => {
    const open = siteNav.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(open));
  });

  // Simulator
  const canvas = document.getElementById('robotArena');
  const simulator = new RobotArenaSimulator(canvas, {
    onTelemetry: sendTelemetry,
    onCommand: sendCommand,
  });

  document.getElementById('chkPatientPresent').addEventListener('change', (e) => {
    simulator.setPatientRecognizable(e.target.checked);
  });

  document.getElementById('btnStartMission').addEventListener('click', () => {
    simulator.startMission(latestState?.activeCompartment || 3);
  });
  document.getElementById('btnStopMission').addEventListener('click', () => simulator.stopMission());
  document.getElementById('btnResetMission').addEventListener('click', () => simulator.resetMission());

  // AI controls
  document.getElementById('btnSimulateMatch').addEventListener('click', () => sendCommand('set_face_match', { match: 1 }));
  document.getElementById('btnSimulateNoMatch').addEventListener('click', () => sendCommand('set_face_match', { match: 0 }));

  const camSlider = document.getElementById('cameraPanSlider');
  camSlider.addEventListener('input', () => {
    const val = Number(camSlider.value);
    document.getElementById('cameraPanValue').textContent = `${val}°`;
    sendTelemetry({ servos: { cameraPan: val } });
  });

  // Obstacle injection
  document.getElementById('btnInjectObstacle').addEventListener('click', () => sendCommand('trigger_obstacle', { distanceCm: 18 }));
  document.getElementById('btnClearObstacle').addEventListener('click', () => sendCommand('clear_obstacle'));

  // Dashboard buttons
  document.getElementById('btnDashStart').addEventListener('click', () => simulator.startMission(latestState?.activeCompartment || 3));
  document.getElementById('btnDashReset').addEventListener('click', () => simulator.resetMission());

  // Save RTC schedules
  document.getElementById('btnSaveSchedules').addEventListener('click', async () => {
    const rows = [1, 2, 3].map((id) => {
      const med = document.querySelector(`[data-comp-id="${id}"][data-field="medicine"]`)?.value || '';
      const time = document.querySelector(`[data-comp-id="${id}"][data-field="time"]`)?.value || '';
      return { id, medicine: med, time };
    });
    await apiPost('/api/schedules', { schedules: rows });
  });

  // Notifications
  document.getElementById('btnTestNotif').addEventListener('click', () =>
    apiPost('/api/notifications/test', {
      type: 'info',
      title: 'Caretaker Alert Test',
      message: 'Test alert sent to caretaker web & mobile notification channel.',
    })
  );
  document.getElementById('btnClearNotif').addEventListener('click', () => apiPost('/api/notifications/clear'));

  // Contact form
  document.getElementById('contactForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const feedback = document.getElementById('contactFeedback');
    try {
      await apiPost('/api/contact', data);
      feedback.textContent = 'Thank you! Your message has been logged for the project team.';
      form.reset();
    } catch (err) {
      feedback.textContent = err.message;
    }
  });
}

initUI();
initSSE();
