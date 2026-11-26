# Hardware Wiring & ESP-NOW Setup Guide

This guide matches the system architecture in the **Automatic Medicine Delivery Robot** specification.

## 1. Controller Division of Responsibilities

| Controller | Connected Peripherals | Role |
|---|---|---|
| **ESP32-CAM** | OV2640 Camera, GPIO 12 (`MATCH_SIGNAL_PIN`), UART | AI face detection & recognition (`1 = Match`, `0 = No Match`) |
| **ESP8266 Board 1** | 6 × SG90 Servos (2 Ultrasonic, 3 Medicine Compartments, 1 Camera Pan) | Wireless servo hub via ESP-NOW |
| **ESP8266 Board 2** | DS3231 RTC, 16×2 I2C LCD, Buzzer, HC-SR04 Ultrasonic, L293D + 2 DC Motors | Autonomous navigation, scheduling, alerts & ESP-NOW master |

---

## 2. Pin Mapping

### ESP8266 Board 1 (6-Servo Hub)
| Servo Function | NodeMCU Pin | GPIO |
|---|---|---|
| SG90 #1 — Ultrasonic Pan | `D1` | GPIO 5 |
| SG90 #2 — Ultrasonic Tilt | `D2` | GPIO 4 |
| SG90 #3 — Medicine Compartment 1 | `D5` | GPIO 14 |
| SG90 #4 — Medicine Compartment 2 | `D6` | GPIO 12 |
| SG90 #5 — Medicine Compartment 3 | `D7` | GPIO 13 |
| SG90 #6 — ESP32-CAM Pan | `D8` | GPIO 15 |

> **Power Note:** Power all 6 × SG90 servos from a dedicated regulated **5V 3A** buck converter rail, sharing a common `GND` with ESP8266 Board 1. Do not draw servo current directly from the ESP8266 3.3V regulator.

### ESP8266 Board 2 (Navigation, RTC, LCD & L293D)
| Peripheral | Signal | NodeMCU Pin | Notes |
|---|---|---|---|
| DS3231 RTC & 16×2 LCD | `SDA` / `SCL` | `D2` / `D1` | Shared I2C bus (`0x68` RTC, `0x27` LCD) |
| HC-SR04 Ultrasonic | `TRIG` / `ECHO` | `D5` / `D6` | Use 1kΩ / 2kΩ voltage divider on `ECHO` (5V → 3.3V) |
| Buzzer | `+` | `D7` | Active 3.3V/5V piezo buzzer |
| ESP32-CAM Signal | `MATCH` | `D0` | Connect to ESP32-CAM `GPIO 12` + common `GND` |
| L293D Left Motor | `IN1` / `IN2` | `D3` / `D4` | Motor A output to Left DC Motor |
| L293D Right Motor | `IN3` / `IN4` | `D8` / `RX` | Motor B output to Right DC Motor |

---

## 3. ESP-NOW Pairing Instructions
1. Flash `esp8266_board1_servos.ino` and open Serial Monitor at `115200` baud to read `Board 1 MAC`.
2. Flash `esp8266_board2_navigation.ino` and read `Board 2 MAC`.
3. Update `board1MacAddress[]` in `esp8266_board2_navigation.ino` and `board2MacAddress[]` in `esp8266_board1_servos.ino`, then re-flash both boards.
4. Set `TELEMETRY_URL` in `esp8266_board2_navigation.ino` to `http://<YOUR_SERVER_IP>:3000/api/telemetry` to stream live hardware updates to the web dashboard.
