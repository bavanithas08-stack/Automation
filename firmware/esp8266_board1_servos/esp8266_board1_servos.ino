/*
 * ESP8266 Board 1 — 6-Servo Controller + ESP-NOW Receiver
 *
 * Controls all 6 SG90 Servos:
 *   1. Ultrasonic Pan Servo  (D1 / GPIO5)
 *   2. Ultrasonic Tilt Servo (D2 / GPIO4)
 *   3. Medicine Compartment 1 Servo (D5 / GPIO14)
 *   4. Medicine Compartment 2 Servo (D6 / GPIO12)
 *   5. Medicine Compartment 3 Servo (D7 / GPIO13)
 *   6. ESP32-CAM Rotation Servo     (D8 / GPIO15)
 */

#include <ESP8266WiFi.h>
#include <espnow.h>
#include <Servo.h>
#include "../common/esp_now_protocol.h"

// Replace with ESP8266 Board 2's STA MAC address
uint8_t board2MacAddress[] = {0xA4, 0xCF, 0x12, 0x8B, 0x11, 0x02};

Servo servoUsPan;
Servo servoUsTilt;
Servo servoComp1;
Servo servoComp2;
Servo servoComp3;
Servo servoCamPan;

const uint8_t PIN_US_PAN   = D1;
const uint8_t PIN_US_TILT  = D2;
const uint8_t PIN_COMP_1   = D5;
const uint8_t PIN_COMP_2   = D6;
const uint8_t PIN_COMP_3   = D7;
const uint8_t PIN_CAM_PAN  = D8;

void resetAllServos() {
  servoUsPan.write(90);
  servoUsTilt.write(90);
  servoCamPan.write(90);
  servoComp1.write(0);
  servoComp2.write(0);
  servoComp3.write(0);
}

void applyCommand(const ServoCommandPacket& cmd) {
  switch (cmd.commandType) {
    case 1: // Rotate ultrasonic sensor pan & tilt
      servoUsPan.write(constrain(cmd.ultrasonicPanDeg, 15, 165));
      servoUsTilt.write(constrain(cmd.ultrasonicTiltDeg, 45, 135));
      break;

    case 2: // Rotate ESP32-CAM pan servo
      servoCamPan.write(constrain(cmd.cameraPanDeg, 15, 165));
      break;

    case 3: // Open/close selected medicine compartment
      if (cmd.compartmentId == 1) servoComp1.write(constrain(cmd.compartmentAngle, 0, 120));
      if (cmd.compartmentId == 2) servoComp2.write(constrain(cmd.compartmentAngle, 0, 120));
      if (cmd.compartmentId == 3) servoComp3.write(constrain(cmd.compartmentAngle, 0, 120));
      break;

    case 4: // Reset all servos to standby
    default:
      resetAllServos();
      break;
  }

  ServoAckPacket ack = {1, cmd.compartmentId, cmd.ultrasonicPanDeg, cmd.cameraPanDeg};
  esp_now_send(board2MacAddress, reinterpret_cast<uint8_t*>(&ack), sizeof(ack));
}

void onEspNowRecv(uint8_t* mac, uint8_t* incomingData, uint8_t len) {
  if (len != sizeof(ServoCommandPacket)) return;
  ServoCommandPacket cmd;
  memcpy(&cmd, incomingData, sizeof(cmd));
  applyCommand(cmd);
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  Serial.print("Board 1 MAC: ");
  Serial.println(WiFi.macAddress());

  servoUsPan.attach(PIN_US_PAN);
  servoUsTilt.attach(PIN_US_TILT);
  servoComp1.attach(PIN_COMP_1);
  servoComp2.attach(PIN_COMP_2);
  servoComp3.attach(PIN_COMP_3);
  servoCamPan.attach(PIN_CAM_PAN);
  resetAllServos();

  if (esp_now_init() != 0) {
    Serial.println("ESP-NOW init failed");
    return;
  }
  esp_now_set_self_role(ESP_NOW_ROLE_COMBO);
  esp_now_add_peer(board2MacAddress, ESP_NOW_ROLE_COMBO, 1, NULL, 0);
  esp_now_register_recv_cb(onEspNowRecv);
}

void loop() {
  // All servo actuation is event-driven from Board 2 via ESP-NOW
  delay(20);
}
