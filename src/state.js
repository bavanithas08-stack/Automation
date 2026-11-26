import { EventEmitter } from 'node:events';

export const ROBOT_STATUSES = [
  'Idle',
  'Searching',
  'Moving',
  'Patient Found',
  'Medicine Delivered',
];

export function createRobotStore() {
  const emitter = new EventEmitter();

  const state = {
    mode: 'simulation', // 'simulation' | 'hardware'
    simulationRunning: false,
    currentTime: '09:00 PM',
    useSystemClock: true,
    robotStatus: 'Searching',
    patientStatus: 'Not Detected', // 'Detected' | 'Not Detected'
    faceMatchSignal: 0, // 1 = Match, 0 = No Match
    medicineStatus: 'Pending', // 'Pending' | 'Dispensed'
    obstacleStatus: 'Clear', // 'Clear' | 'Obstacle Detected'
    obstacleDistanceCm: 142,
    batteryPercent: 94,
    batteryVoltage: 11.9,
    activeStep: 1, // 1..7 matching "How It Works"
    activeCompartment: 1, // 1..3
    lcd: {
      line1: 'MEDBOT READY    ',
      line2: 'RTC: 09:00 PM   ',
    },
    buzzerActive: false,
    espNowLink: {
      connected: true,
      lastPacketMs: 18,
      board1Mac: 'A4:CF:12:8B:11:01',
      board2Mac: 'A4:CF:12:8B:11:02',
    },
    servos: {
      ultrasonicPan: 90,
      ultrasonicTilt: 90,
      cameraPan: 90,
      compartments: [
        { id: 1, label: 'Morning Dose', medicine: 'Metformin 500mg', time: '08:00 AM', angle: 0, status: 'Pending' },
        { id: 2, label: 'Afternoon Dose', medicine: 'Vitamin D3', time: '01:00 PM', angle: 0, status: 'Pending' },
        { id: 3, label: 'Night Dose', medicine: 'Atorvastatin 10mg', time: '09:00 PM', angle: 0, status: 'Pending' },
      ],
    },
    motors: {
      leftDirection: 'STOP',
      rightDirection: 'STOP',
      speed: 0,
    },
    patientProfile: {
      id: 'PAT-104',
      name: 'Registered Patient #1',
      ward: 'Room 204 - Bed B',
      confidence: 0,
    },
    notifications: [
      {
        id: 'notif-init-1',
        timestamp: new Date().toISOString(),
        type: 'info',
        title: 'RTC Schedule Armed',
        message: 'Night Dose (Compartment 3) scheduled for 09:00 PM. ESP-NOW link online.',
        channel: 'Dashboard + LCD',
      },
    ],
    contactMessages: [],
    lastUpdated: new Date().toISOString(),
  };

  function emitChange() {
    state.lastUpdated = new Date().toISOString();
    emitter.emit('update', getPublicState());
  }

  function addNotification({ type = 'info', title, message, channel = 'Caretaker Alert' }) {
    const entry = {
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      type,
      title,
      message,
      channel,
    };
    state.notifications.unshift(entry);
    if (state.notifications.length > 40) {
      state.notifications.length = 40;
    }
    return entry;
  }

  function formatLcdLine(text) {
    return String(text || '').slice(0, 16).padEnd(16, ' ');
  }

  function setLcd(line1, line2) {
    state.lcd.line1 = formatLcdLine(line1);
    state.lcd.line2 = formatLcdLine(line2);
  }

  function getPublicState() {
    return structuredClone(state);
  }

  function applyTelemetry(payload = {}) {
    if (payload.mode === 'hardware' || payload.mode === 'simulation') {
      state.mode = payload.mode;
    }
    if (typeof payload.currentTime === 'string' && payload.currentTime.trim()) {
      state.currentTime = payload.currentTime.trim();
      state.useSystemClock = false;
    }
    if (ROBOT_STATUSES.includes(payload.robotStatus)) {
      state.robotStatus = payload.robotStatus;
    }
    if (payload.faceMatchSignal === 0 || payload.faceMatchSignal === 1) {
      state.faceMatchSignal = payload.faceMatchSignal;
      state.patientStatus = payload.faceMatchSignal === 1 ? 'Detected' : 'Not Detected';
      state.patientProfile.confidence = payload.faceMatchSignal === 1
        ? Number(payload.confidence ?? 96.4)
        : 0;
    } else if (payload.patientStatus === 'Detected' || payload.patientStatus === 'Not Detected') {
      state.patientStatus = payload.patientStatus;
      state.faceMatchSignal = payload.patientStatus === 'Detected' ? 1 : 0;
    }

    if (typeof payload.obstacleDistanceCm === 'number' && Number.isFinite(payload.obstacleDistanceCm)) {
      state.obstacleDistanceCm = Math.max(2, Math.min(400, Math.round(payload.obstacleDistanceCm)));
      state.obstacleStatus = state.obstacleDistanceCm < 30 ? 'Obstacle Detected' : 'Clear';
    }
    if (payload.obstacleStatus === 'Clear' || payload.obstacleStatus === 'Obstacle Detected') {
      state.obstacleStatus = payload.obstacleStatus;
    }

    if (typeof payload.batteryPercent === 'number' && Number.isFinite(payload.batteryPercent)) {
      state.batteryPercent = Math.max(0, Math.min(100, Math.round(payload.batteryPercent)));
    }
    if (typeof payload.batteryVoltage === 'number' && Number.isFinite(payload.batteryVoltage)) {
      state.batteryVoltage = Number(Math.max(0, Math.min(15, payload.batteryVoltage)).toFixed(2));
    }

    if (payload.medicineStatus === 'Pending' || payload.medicineStatus === 'Dispensed') {
      state.medicineStatus = payload.medicineStatus;
    }
    if (typeof payload.activeStep === 'number' && payload.activeStep >= 1 && payload.activeStep <= 7) {
      state.activeStep = Math.round(payload.activeStep);
    }
    if (typeof payload.activeCompartment === 'number' && payload.activeCompartment >= 1 && payload.activeCompartment <= 3) {
      state.activeCompartment = Math.round(payload.activeCompartment);
    }
    if (payload.servos && typeof payload.servos === 'object') {
      if (typeof payload.servos.ultrasonicPan === 'number') state.servos.ultrasonicPan = clampAngle(payload.servos.ultrasonicPan);
      if (typeof payload.servos.ultrasonicTilt === 'number') state.servos.ultrasonicTilt = clampAngle(payload.servos.ultrasonicTilt);
      if (typeof payload.servos.cameraPan === 'number') state.servos.cameraPan = clampAngle(payload.servos.cameraPan);
    }
    if (payload.motors && typeof payload.motors === 'object') {
      state.motors = {
        leftDirection: payload.motors.leftDirection || state.motors.leftDirection,
        rightDirection: payload.motors.rightDirection || state.motors.rightDirection,
        speed: typeof payload.motors.speed === 'number' ? payload.motors.speed : state.motors.speed,
      };
    }
    if (typeof payload.buzzerActive === 'boolean') {
      state.buzzerActive = payload.buzzerActive;
    }
    if (typeof payload.lcdLine1 === 'string' || typeof payload.lcdLine2 === 'string') {
      setLcd(payload.lcdLine1 ?? state.lcd.line1, payload.lcdLine2 ?? state.lcd.line2);
    }
    if (payload.notification && payload.notification.title) {
      addNotification(payload.notification);
    }

    emitChange();
    return getPublicState();
  }

  function handleCommand(action, params = {}) {
    switch (action) {
      case 'start_delivery': {
        const compId = Number(params.compartmentId || state.activeCompartment || 3);
        state.activeCompartment = compId >= 1 && compId <= 3 ? compId : 1;
        state.simulationRunning = true;
        state.activeStep = 2;
        state.robotStatus = 'Moving';
        state.patientStatus = 'Not Detected';
        state.faceMatchSignal = 0;
        state.medicineStatus = 'Pending';
        state.obstacleStatus = 'Clear';
        state.buzzerActive = false;
        state.motors = { leftDirection: 'FWD', rightDirection: 'FWD', speed: 180 };
        setLcd('SCHEDULE ACTIVE ', `MOVING COMP #${state.activeCompartment}  `);
        addNotification({
          type: 'info',
          title: 'Scheduled Delivery Started',
          message: `RTC matched schedule. Robot moving to deliver Compartment #${state.activeCompartment}.`,
          channel: 'ESP8266 Board 2 -> ESP-NOW',
        });
        break;
      }

      case 'stop_robot': {
        state.simulationRunning = false;
        state.robotStatus = 'Idle';
        state.motors = { leftDirection: 'STOP', rightDirection: 'STOP', speed: 0 };
        state.buzzerActive = false;
        setLcd('ROBOT STOPPED   ', 'STANDBY MODE    ');
        break;
      }

      case 'set_searching': {
        state.activeStep = 3;
        state.robotStatus = 'Searching';
        state.motors = { leftDirection: 'FWD', rightDirection: 'REV', speed: 120 };
        setLcd('SEARCHING...    ', 'SCANNING AREA   ');
        break;
      }

      case 'trigger_obstacle': {
        const dist = typeof params.distanceCm === 'number' ? params.distanceCm : 18;
        state.obstacleDistanceCm = dist;
        state.obstacleStatus = 'Obstacle Detected';
        state.robotStatus = 'Searching';
        state.activeStep = 3;
        state.motors = { leftDirection: 'STOP', rightDirection: 'STOP', speed: 0 };
        state.buzzerActive = true;
        state.servos.ultrasonicPan = params.scanAngle ?? 145;
        setLcd(`OBSTACLE ${String(dist).padStart(3, ' ')}CM  `, 'SCANNING ALT DIR');
        addNotification({
          type: 'warning',
          title: 'Obstacle Detected',
          message: `Ultrasonic sensor detected obstacle at ${dist} cm. Robot halted and rotating sensor servos.`,
          channel: 'Navigation Controller',
        });
        break;
      }

      case 'clear_obstacle': {
        state.obstacleDistanceCm = 135;
        state.obstacleStatus = 'Clear';
        state.buzzerActive = false;
        state.servos.ultrasonicPan = 90;
        state.robotStatus = 'Moving';
        state.motors = { leftDirection: 'FWD', rightDirection: 'FWD', speed: 175 };
        setLcd('PATH CLEAR      ', 'RESUMING ROUTE  ');
        break;
      }

      case 'set_face_match': {
        const match = params.match === 1 || params.match === true ? 1 : 0;
        state.faceMatchSignal = match;
        state.patientStatus = match === 1 ? 'Detected' : 'Not Detected';
        state.patientProfile.confidence = match === 1 ? 97.2 : 0;
        if (match === 1) {
          state.activeStep = 5;
          state.robotStatus = 'Patient Found';
          state.motors = { leftDirection: 'STOP', rightDirection: 'STOP', speed: 0 };
          state.buzzerActive = true;
          setLcd('PATIENT FOUND!  ', 'FACE MATCH = 1  ');
          addNotification({
            type: 'success',
            title: 'Patient Verified (Match = 1)',
            message: `ESP32-CAM recognized ${state.patientProfile.name}. Ready to dispense Compartment #${state.activeCompartment}.`,
            channel: 'ESP32-CAM + Caretaker',
          });
        } else {
          state.activeStep = 4;
          state.robotStatus = 'Searching';
          state.buzzerActive = true;
          setLcd('NO FACE MATCH   ', 'SIGNAL = 0      ');
          addNotification({
            type: 'warning',
            title: 'Patient Not Detected (Match = 0)',
            message: 'ESP32-CAM could not verify the registered patient. Caretaker notified.',
            channel: 'Caretaker Alert',
          });
        }
        break;
      }

      case 'dispense_compartment': {
        const compId = Number(params.compartmentId || state.activeCompartment || 1);
        const comp = state.servos.compartments.find((c) => c.id === compId);
        if (!comp) {
          throw new Error(`Invalid compartment ID: ${compId}`);
        }
        if (state.faceMatchSignal !== 1 && !params.overrideSafety) {
          addNotification({
            type: 'warning',
            title: 'Dispense Blocked — Safety Interlock',
            message: `Cannot open Compartment #${compId} without valid AI face match (1 = Match).`,
            channel: 'Safety Lock',
          });
          setLcd('VERIFY PATIENT! ', 'DISPENSE LOCKED ');
          break;
        }
        state.activeCompartment = compId;
        comp.angle = 90;
        comp.status = 'Dispensed';
        state.medicineStatus = 'Dispensed';
        state.robotStatus = 'Medicine Delivered';
        state.activeStep = 7;
        state.simulationRunning = false;
        state.buzzerActive = true;
        state.motors = { leftDirection: 'STOP', rightDirection: 'STOP', speed: 0 };
        setLcd(`DISPENSED COMP#${compId}`, 'MED DELIVERED OK');
        addNotification({
          type: 'success',
          title: `Medicine Delivered — Compartment #${compId}`,
          message: `${comp.label} (${comp.medicine}) dispensed to ${state.patientProfile.name}. Caretaker notified.`,
          channel: 'ESP-NOW + Caretaker SMS/Web',
        });
        break;
      }

      case 'reset_compartments': {
        for (const comp of state.servos.compartments) {
          comp.angle = 0;
          comp.status = 'Pending';
        }
        state.medicineStatus = 'Pending';
        state.robotStatus = 'Searching';
        state.patientStatus = 'Not Detected';
        state.faceMatchSignal = 0;
        state.patientProfile.confidence = 0;
        state.obstacleStatus = 'Clear';
        state.obstacleDistanceCm = 142;
        state.activeStep = 1;
        state.buzzerActive = false;
        state.simulationRunning = false;
        state.motors = { leftDirection: 'STOP', rightDirection: 'STOP', speed: 0 };
        setLcd('MEDBOT READY    ', `RTC: ${state.currentTime.slice(0, 11)}`);
        addNotification({
          type: 'info',
          title: 'System Reset',
          message: 'All 3 medicine compartment servos closed (0 deg) and status reset to Pending.',
          channel: 'Dashboard',
        });
        break;
      }

      case 'set_step': {
        const step = Number(params.step);
        if (step >= 1 && step <= 7) {
          state.activeStep = step;
        }
        break;
      }

      default:
        throw new Error(`Unknown command: ${action}`);
    }

    emitChange();
    return getPublicState();
  }

  function updateSchedules(schedules = []) {
    if (!Array.isArray(schedules)) {
      throw new Error('Schedules must be an array');
    }
    for (const item of schedules) {
      const comp = state.servos.compartments.find((c) => c.id === Number(item.id));
      if (comp) {
        if (typeof item.time === 'string' && item.time.trim()) comp.time = item.time.trim();
        if (typeof item.medicine === 'string' && item.medicine.trim()) comp.medicine = item.medicine.trim();
        if (typeof item.label === 'string' && item.label.trim()) comp.label = item.label.trim();
      }
    }
    addNotification({
      type: 'info',
      title: 'RTC Schedule Updated',
      message: 'Medicine delivery times synchronized with DS3231 RTC schedule.',
      channel: 'RTC Module',
    });
    emitChange();
    return getPublicState();
  }

  function addContactMessage({ name, email, message }) {
    if (!name || !email || !message) {
      throw new Error('Name, email, and message are required.');
    }
    const entry = {
      id: `msg-${Date.now()}`,
      name: String(name).trim().slice(0, 80),
      email: String(email).trim().slice(0, 120),
      message: String(message).trim().slice(0, 1000),
      createdAt: new Date().toISOString(),
    };
    state.contactMessages.unshift(entry);
    if (state.contactMessages.length > 20) state.contactMessages.length = 20;
    addNotification({
      type: 'info',
      title: 'New Contact Inquiry',
      message: `Message received from ${entry.name} (${entry.email}).`,
      channel: 'Website Contact Form',
    });
    emitChange();
    return entry;
  }

  function clearNotifications() {
    state.notifications = [];
    emitChange();
    return getPublicState();
  }

  return {
    emitter,
    getPublicState,
    applyTelemetry,
    handleCommand,
    updateSchedules,
    addContactMessage,
    clearNotifications,
    addNotification,
  };
}

function clampAngle(val) {
  return Math.max(0, Math.min(180, Math.round(val)));
}
