# Automatic Medicine Delivery Robot

**AI-Based Patient Identification and Autonomous Medicine Delivery**

> *"An AI-enabled autonomous robot that identifies the correct patient and delivers scheduled medicines safely and automatically."*

---

## Project Overview

This repository contains the complete **Website & Live Telemetry Dashboard**, **Interactive Autonomous Robot Simulator**, and **Embedded Firmware (ESP32-CAM + 2× ESP8266 via ESP-NOW)** for the Automatic Medicine Delivery Robot.

### Key Features
- **Scheduled medicine delivery using RTC** (DS3231 + configurable 3-compartment schedule)
- **AI-based patient face recognition** (`1 = Match`, `0 = No Match` via ESP32-CAM)
- **Autonomous forward, backward, and turning movement** (L293D Motor Driver + 2× DC Motors)
- **Ultrasonic obstacle detection & dual-servo scanning** (HC-SR04 + 2× SG90 Servos)
- **ESP-NOW wireless communication** between ESP8266 Board 1 and ESP8266 Board 2
- **Three-compartment automatic medicine dispensing** (3× SG90 Servos with face-match safety interlock)
- **16×2 I2C LCD & buzzer status indication**
- **Caretaker notification capability** (real-time alert log & HTTP/SSE updates)
- **Servo-based camera rotation** (1× SG90 Servo for ESP32-CAM panning)

---

## Folder Structure

```text
├── package.json
├── README.md
├── src/
│   ├── server.js                      # Zero-dependency Node.js HTTP + SSE server
│   └── state.js                       # Robot state machine, RTC schedules, safety interlock & notifications
├── public/
│   ├── index.html                     # Complete 10-section responsive project website
│   ├── styles.css                     # Clinical-robotics UI styling
│   ├── app.js                         # Live SSE client, LCD/buzzer emulator & controls
│   └── simulator.js                   # Interactive 2D Canvas navigation & obstacle avoidance simulator
├── firmware/
│   ├── common/
│   │   └── esp_now_protocol.h         # Shared ESP-NOW command & ACK packets
│   ├── esp32_cam_vision/
│   │   └── esp32_cam_vision.ino       # ESP32-CAM AI face detection/recognition (1=Match / 0=No Match)
│   ├── esp8266_board1_servos/
│   │   └── esp8266_board1_servos.ino  # ESP8266 Board 1 (6× SG90 Servos + ESP-NOW)
│   ├── esp8266_board2_navigation/
│   │   └── esp8266_board2_navigation.ino # ESP8266 Board 2 (RTC, LCD, Buzzer, HC-SR04, L293D, ESP-NOW)
│   └── WIRING_GUIDE.md                # Pin mapping, power rail notes & MAC pairing steps
└── tests/
    └── server.test.js                 # Automated Node test suite
```

---

## Quick Start (Web Dashboard & Simulator)

Requires **Node.js 18+** (no external npm packages required).

```bash
# Run automated tests
npm test

# Start the web application & telemetry server
npm start
```

Open **http://localhost:3000** in your browser.

---

## Hardware Telemetry Integration

ESP8266 Board 2 (or any test script) can push live updates to `POST /api/telemetry`:

```json
{
  "mode": "hardware",
  "robotStatus": "Patient Found",
  "faceMatchSignal": 1,
  "obstacleDistanceCm": 85,
  "batteryPercent": 92,
  "batteryVoltage": 11.8
}
```

See [firmware/WIRING_GUIDE.md](firmware/WIRING_GUIDE.md) for pinouts and flashing instructions.
