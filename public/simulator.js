export class RobotArenaSimulator {
  constructor(canvas, { onTelemetry, onCommand }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onTelemetry = onTelemetry;
    this.onCommand = onCommand;

    this.dock = { x: 80, y: 210 };
    this.patient = { x: 665, y: 210, radius: 26 };
    this.obstacles = [
      { x: 310, y: 185, r: 26 },
      { x: 475, y: 270, r: 24 },
    ];

    this.resetRobot();
    this.patientRecognizable = true;
    this.running = false;
    this.phase = 'idle'; // idle | moving | avoiding | scanning_face | verified | delivered | not_found
    this.scanTick = 0;
    this.lastTelemetrySent = 0;
    this.rafId = null;

    this.bindEvents();
    this.draw();
  }

  resetRobot() {
    this.robot = {
      x: this.dock.x,
      y: this.dock.y,
      angle: 0,
      radius: 20,
      usPanDeg: 90,
      usTiltDeg: 90,
      camPanDeg: 90,
      distanceCm: 142,
      avoidTimer: 0,
      avoidTurnDir: -1,
    };
    this.phase = 'idle';
    this.running = false;
    this.draw();
  }

  setPatientRecognizable(val) {
    this.patientRecognizable = Boolean(val);
  }

  bindEvents() {
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;

      // Ignore clicks directly on dock or patient
      if (Math.hypot(cx - this.dock.x, cy - this.dock.y) < 42) return;
      if (Math.hypot(cx - this.patient.x, cy - this.patient.y) < 46) return;

      const idx = this.obstacles.findIndex((o) => Math.hypot(cx - o.x, cy - o.y) <= o.r + 8);
      if (idx >= 0) {
        this.obstacles.splice(idx, 1);
      } else {
        this.obstacles.push({ x: cx, y: cy, r: 24 });
      }
      this.draw();
    });
  }

  async startMission(compartmentId = 3) {
    this.resetRobot();
    this.targetCompartment = compartmentId;
    this.running = true;
    this.phase = 'moving';
    await this.onCommand('start_delivery', { compartmentId });
    this.loop();
  }

  async stopMission() {
    this.running = false;
    this.phase = 'idle';
    if (this.rafId) cancelAnimationFrame(this.rafId);
    await this.onCommand('stop_robot');
    this.draw();
  }

  async resetMission() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.resetRobot();
    await this.onCommand('reset_compartments');
    this.draw();
  }

  measureUltrasonic(rayAngleRad) {
    let minDist = 220;
    const step = 4;
    for (let d = this.robot.radius; d <= 220; d += step) {
      const px = this.robot.x + Math.cos(rayAngleRad) * d;
      const py = this.robot.y + Math.sin(rayAngleRad) * d;
      if (px < 12 || px > this.canvas.width - 12 || py < 12 || py > this.canvas.height - 12) {
        minDist = Math.min(minDist, d);
        break;
      }
      for (const obs of this.obstacles) {
        if (Math.hypot(px - obs.x, py - obs.y) <= obs.r + 6) {
          minDist = Math.min(minDist, d);
          return Math.round(minDist * 0.75);
        }
      }
    }
    return Math.round(minDist * 0.75);
  }

  loop = async () => {
    if (!this.running) return;
    this.scanTick += 1;

    const dx = this.patient.x - this.robot.x;
    const dy = this.patient.y - this.robot.y;
    const distToPatient = Math.hypot(dx, dy);
    const targetAngle = Math.atan2(dy, dx);

    if (this.phase === 'moving') {
      // Smoothly steer toward patient
      let angleDiff = targetAngle - this.robot.angle;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      this.robot.angle += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), 0.05);

      // Sweep ultrasonic pan servo slightly while cruising
      this.robot.usPanDeg = 90 + Math.round(Math.sin(this.scanTick * 0.12) * 28);
      const rayAngle = this.robot.angle + ((this.robot.usPanDeg - 90) * Math.PI) / 180;
      const frontDist = this.measureUltrasonic(this.robot.angle);
      this.robot.distanceCm = frontDist;

      if (frontDist < 34) {
        // Obstacle encountered: stop, scan left & right with servos
        this.phase = 'avoiding';
        this.robot.avoidTimer = 36;
        const leftDist = this.measureUltrasonic(this.robot.angle - 0.75);
        const rightDist = this.measureUltrasonic(this.robot.angle + 0.75);
        this.robot.avoidTurnDir = leftDist >= rightDist ? -1 : 1;
        this.robot.usPanDeg = this.robot.avoidTurnDir < 0 ? 45 : 135;
        this.pushTelemetry({
          robotStatus: 'Searching',
          activeStep: 3,
          obstacleDistanceCm: frontDist,
          obstacleStatus: 'Obstacle Detected',
          buzzerActive: true,
          servos: { ultrasonicPan: this.robot.usPanDeg, ultrasonicTilt: 82 },
          motors: { leftDirection: 'STOP', rightDirection: 'STOP', speed: 0 },
          lcdLine1: `OBSTACLE ${String(frontDist).padStart(3, ' ')}CM`,
          lcdLine2: 'SCANNING ALT DIR',
        });
      } else if (distToPatient < 68) {
        // Reached patient search zone -> begin AI Verification
        this.phase = 'scanning_face';
        this.robot.avoidTimer = 48;
        this.pushTelemetry({
          robotStatus: 'Searching',
          activeStep: 4,
          obstacleDistanceCm: Math.round(distToPatient),
          obstacleStatus: 'Clear',
          buzzerActive: false,
          motors: { leftDirection: 'STOP', rightDirection: 'STOP', speed: 0 },
          lcdLine1: 'ESP32-CAM SCAN  ',
          lcdLine2: 'VERIFYING FACE..',
        });
      } else {
        this.robot.x += Math.cos(this.robot.angle) * 2.1;
        this.robot.y += Math.sin(this.robot.angle) * 2.1;
        if (this.scanTick % 14 === 0) {
          this.pushTelemetry({
            robotStatus: 'Moving',
            activeStep: 2,
            obstacleDistanceCm: frontDist,
            obstacleStatus: 'Clear',
            servos: { ultrasonicPan: this.robot.usPanDeg, ultrasonicTilt: 90 },
            motors: { leftDirection: 'FWD', rightDirection: 'FWD', speed: 180 },
            lcdLine1: 'MOVING TO WARD  ',
            lcdLine2: `DIST: ${String(frontDist).padStart(3, ' ')} CM    `,
          });
        }
      }
      // Also visualize swept ray
      this.robot.lastRayAngle = rayAngle;
    } else if (this.phase === 'avoiding') {
      this.robot.avoidTimer -= 1;
      this.robot.angle += this.robot.avoidTurnDir * 0.048;
      if (this.robot.avoidTimer < 16) {
        this.robot.x += Math.cos(this.robot.angle) * 1.9;
        this.robot.y += Math.sin(this.robot.angle) * 1.9;
      }
      if (this.robot.avoidTimer <= 0) {
        this.phase = 'moving';
        this.robot.usPanDeg = 90;
        this.pushTelemetry({
          robotStatus: 'Moving',
          activeStep: 3,
          obstacleDistanceCm: this.measureUltrasonic(this.robot.angle),
          obstacleStatus: 'Clear',
          buzzerActive: false,
          servos: { ultrasonicPan: 90, ultrasonicTilt: 90 },
          motors: { leftDirection: 'FWD', rightDirection: 'FWD', speed: 175 },
        });
      }
    } else if (this.phase === 'scanning_face') {
      this.robot.avoidTimer -= 1;
      this.robot.camPanDeg = 90 + Math.round(Math.sin(this.scanTick * 0.22) * 35);
      if (this.scanTick % 12 === 0) {
        this.pushTelemetry({
          servos: { cameraPan: this.robot.camPanDeg },
        });
      }
      if (this.robot.avoidTimer <= 0) {
        this.robot.camPanDeg = 90;
        if (this.patientRecognizable) {
          this.phase = 'verified';
          await this.onCommand('set_face_match', { match: 1 });
          setTimeout(async () => {
            if (!this.running) return;
            this.phase = 'delivered';
            this.running = false;
            await this.onCommand('dispense_compartment', { compartmentId: this.targetCompartment });
            this.draw();
          }, 950);
        } else {
          this.phase = 'not_found';
          this.running = false;
          await this.onCommand('set_face_match', { match: 0 });
        }
      }
    }

    this.draw();
    if (this.running) {
      this.rafId = requestAnimationFrame(this.loop);
    }
  };

  pushTelemetry(payload) {
    const now = performance.now();
    if (now - this.lastTelemetrySent < 120) return;
    this.lastTelemetrySent = now;
    this.onTelemetry(payload);
  }

  draw() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);

    // Subtle hospital floor grid
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 38) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 38) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Charging Dock
    ctx.fillStyle = '#e2e8f0';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.fillRect(this.dock.x - 32, this.dock.y - 32, 64, 64);
    ctx.strokeRect(this.dock.x - 32, this.dock.y - 32, 64, 64);
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DOCK', this.dock.x, this.dock.y + 48);

    // Patient Bed Zone
    ctx.beginPath();
    ctx.arc(this.patient.x, this.patient.y, this.patient.radius + 14, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(2, 132, 199, 0.12)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(this.patient.x, this.patient.y, this.patient.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#0284c7';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('PATIENT', this.patient.x, this.patient.y + 4);

    // Obstacles
    for (const obs of this.obstacles) {
      ctx.beginPath();
      ctx.arc(obs.x, obs.y, obs.r, 0, Math.PI * 2);
      ctx.fillStyle = '#fee2e2';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#dc2626';
      ctx.stroke();
      ctx.fillStyle = '#991b1b';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText('OBS', obs.x, obs.y + 4);
    }

    // Ultrasonic cone
    const coneAngle = this.robot.angle + ((this.robot.usPanDeg - 90) * Math.PI) / 180;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(this.robot.x, this.robot.y);
    ctx.arc(this.robot.x, this.robot.y, 125, coneAngle - 0.28, coneAngle + 0.28);
    ctx.closePath();
    ctx.fillStyle = this.phase === 'avoiding' ? 'rgba(220, 38, 38, 0.18)' : 'rgba(14, 165, 233, 0.16)';
    ctx.fill();
    ctx.restore();

    // Robot body
    ctx.save();
    ctx.translate(this.robot.x, this.robot.y);
    ctx.rotate(this.robot.angle);

    ctx.beginPath();
    ctx.arc(0, 0, this.robot.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#0f766e';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();

    // Direction arrow / ultrasonic front bar
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(10, -8, 9, 16);

    ctx.restore();
  }
}
