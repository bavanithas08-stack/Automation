/*
 * ESP8266 Board 2 — RTC, 16x2 I2C LCD, Buzzer, Ultrasonic, L293D Motors & ESP-NOW Master
 *
 * Responsibilities:
 * - Reads scheduled medicine times from DS3231 RTC (I2C: SDA=D2, SCL=D1)
 * - Displays status on 16x2 I2C LCD (address 0x27)
 * - Drives 2 DC motors via L293D Motor Driver
 * - Measures obstacle distance with HC-SR04 Ultrasonic Sensor
 * - Reads ESP32-CAM verification input (1 = Match, 0 = No Match)
 * - Sends servo commands to ESP8266 Board 1 over ESP-NOW
 * - Optionally posts live JSON telemetry to the web dashboard (/api/telemetry)
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <RTClib.h>
#include <espnow.h>
#include "../common/esp_now_protocol.h"

// Replace with ESP8266 Board 1's STA MAC address
uint8_t board1MacAddress[] = {0xA4, 0xCF, 0x12, 0x8B, 0x11, 0x01};

// Optional dashboard server URL for live telemetry
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
const char* TELEMETRY_URL = "http://192.168.1.100:3000/api/telemetry";

// Pin Mapping (NodeMCU ESP8266)
const uint8_t PIN_TRIG       = D5;
const uint8_t PIN_ECHO       = D6;
const uint8_t PIN_BUZZER     = D7;
const uint8_t PIN_CAM_MATCH  = D0; // Connected to ESP32-CAM MATCH_SIGNAL_PIN (via 3.3V)

// L293D Motor Driver Pins
const uint8_t MOTOR_L_IN1    = D3;
const uint8_t MOTOR_L_IN2    = D4;
const uint8_t MOTOR_R_IN3    = D8;
const uint8_t MOTOR_R_IN4    = 3;  // RX pin (use TX/RX carefully when not debugging over USB)

LiquidCrystal_I2C lcd(0x27, 16, 2);
RTC_DS3231 rtc;

// Scheduled medicine hours/minutes for the 3 compartments
struct ScheduleSlot {
  uint8_t hour;
  uint8_t minute;
  uint8_t compartmentId;
  bool dispensedToday;
};

ScheduleSlot schedules[3] = {
  {8,  0, 1, false},
  {13, 0, 2, false},
  {21, 0, 3, false}, // 09:00 PM
};

enum RobotState {
  STATE_IDLE,
  STATE_MOVING,
  STATE_AVOIDING,
  STATE_VERIFYING,
  STATE_DELIVERED
};

RobotState currentState = STATE_IDLE;
uint8_t activeCompartment = 1;

void sendServoCommand(uint8_t type, uint8_t usPan, uint8_t usTilt, uint8_t camPan, uint8_t compId, uint8_t compAngle) {
  ServoCommandPacket pkt = {type, usPan, usTilt, camPan, compId, compAngle};
  esp_now_send(board1MacAddress, reinterpret_cast<uint8_t*>(&pkt), sizeof(pkt));
}

void updateLcd(const String& line1, const String& line2) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1.substring(0, 16));
  lcd.setCursor(0, 1);
  lcd.print(line2.substring(0, 16));
}

void beepBuzzer(uint8_t times, uint16_t durationMs) {
  for (uint8_t i = 0; i < times; i++) {
    digitalWrite(PIN_BUZZER, HIGH);
    delay(durationMs);
    digitalWrite(PIN_BUZZER, LOW);
    delay(80);
  }
}

void setMotors(int leftDir, int rightDir) {
  digitalWrite(MOTOR_L_IN1, leftDir > 0 ? HIGH : LOW);
  digitalWrite(MOTOR_L_IN2, leftDir < 0 ? HIGH : LOW);
  digitalWrite(MOTOR_R_IN3, rightDir > 0 ? HIGH : LOW);
  digitalWrite(MOTOR_R_IN4, rightDir < 0 ? HIGH : LOW);
}

long measureDistanceCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  long duration = pulseIn(PIN_ECHO, HIGH, 25000);
  if (duration == 0) return 200;
  return (duration * 0.0343) / 2;
}

void postTelemetry(const String& status, int faceMatch, long distanceCm, const String& medStatus) {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClient client;
  HTTPClient http;
  if (http.begin(client, TELEMETRY_URL)) {
    http.addHeader("Content-Type", "application/json");
    String payload = "{";
    payload += "\"mode\":\"hardware\",";
    payload += "\"robotStatus\":\"" + status + "\",";
    payload += "\"faceMatchSignal\":" + String(faceMatch) + ",";
    payload += "\"obstacleDistanceCm\":" + String(distanceCm) + ",";
    payload += "\"medicineStatus\":\"" + medStatus + "\",";
    payload += "\"activeCompartment\":" + String(activeCompartment);
    payload += "}";
    http.POST(payload);
    http.end();
  }
}

void setup() {
  Serial.begin(115200);
  Wire.begin(D2, D1);

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_CAM_MATCH, INPUT);

  pinMode(MOTOR_L_IN1, OUTPUT);
  pinMode(MOTOR_L_IN2, OUTPUT);
  pinMode(MOTOR_R_IN3, OUTPUT);
  pinMode(MOTOR_R_IN4, OUTPUT);
  setMotors(0, 0);

  lcd.init();
  lcd.backlight();
  updateLcd("MEDBOT STARTING", "INIT RTC & NOW ");

  if (!rtc.begin()) {
    updateLcd("RTC ERROR!", "CHECK WIRING");
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  if (esp_now_init() != 0) {
    updateLcd("ESP-NOW ERROR", "RESTART BOARD");
    return;
  }
  esp_now_set_self_role(ESP_NOW_ROLE_COMBO);
  esp_now_add_peer(board1MacAddress, ESP_NOW_ROLE_COMBO, 1, NULL, 0);

  sendServoCommand(4, 90, 90, 90, 1, 0);
  updateLcd("MEDBOT READY", "WAITING SCHEDULE");
}

void loop() {
  DateTime now = rtc.now();

  if (currentState == STATE_IDLE) {
    for (int i = 0; i < 3; i++) {
      if (!schedules[i].dispensedToday &&
          now.hour() == schedules[i].hour &&
          now.minute() == schedules[i].minute) {
        activeCompartment = schedules[i].compartmentId;
        schedules[i].dispensedToday = true;
        currentState = STATE_MOVING;
        updateLcd("SCHEDULE ACTIVE", "STARTING ROUTE");
        beepBuzzer(1, 150);
        postTelemetry("Moving", 0, 150, "Pending");
        break;
      }
    }
    delay(500);
    return;
  }

  long dist = measureDistanceCm();
  if (dist < 28) {
    // Obstacle detected -> stop, scan left and right with ultrasonic servos
    setMotors(0, 0);
    beepBuzzer(2, 90);
    updateLcd("OBSTACLE FOUND", "SCANNING PATH");
    postTelemetry("Searching", 0, dist, "Pending");

    sendServoCommand(1, 40, 90, 90, activeCompartment, 0);
    delay(350);
    long leftDist = measureDistanceCm();

    sendServoCommand(1, 140, 90, 90, activeCompartment, 0);
    delay(350);
    long rightDist = measureDistanceCm();

    sendServoCommand(1, 90, 90, 90, activeCompartment, 0);
    delay(200);

    if (leftDist >= rightDist) {
      setMotors(-1, 1); // Turn Left
    } else {
      setMotors(1, -1); // Turn Right
    }
    delay(420);
    setMotors(0, 0);
  } else {
    // Check AI face verification signal from ESP32-CAM (1 = Match, 0 = No Match)
    int faceMatch = digitalRead(PIN_CAM_MATCH) == HIGH ? 1 : 0;
    if (faceMatch == 1) {
      setMotors(0, 0);
      updateLcd("PATIENT FOUND!", "DISPENSING MED");
      beepBuzzer(2, 180);
      postTelemetry("Patient Found", 1, dist, "Pending");

      // Open the scheduled medicine compartment via ESP-NOW on Board 1
      sendServoCommand(3, 90, 90, 90, activeCompartment, 90);
      delay(4000);
      // Close compartment after delivery
      sendServoCommand(3, 90, 90, 90, activeCompartment, 0);

      updateLcd("MED DELIVERED", "CARETAKER SENT");
      postTelemetry("Medicine Delivered", 1, dist, "Dispensed");
      currentState = STATE_IDLE;
    } else {
      // Continue moving and searching
      setMotors(1, 1);
      sendServoCommand(2, 90, 90, 90, activeCompartment, 0);
      delay(150);
    }
  }
}
