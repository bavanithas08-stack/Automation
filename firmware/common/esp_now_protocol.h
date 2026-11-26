#ifndef ESP_NOW_PROTOCOL_H
#define ESP_NOW_PROTOCOL_H

#include <Arduino.h>

// Shared ESP-NOW command packet sent from ESP8266 Board 2 (Navigation/RTC)
// to ESP8266 Board 1 (6-Servo Controller).
typedef struct __attribute__((packed)) {
  uint8_t commandType;        // 1 = Scan Ultrasonic, 2 = Camera Pan, 3 = Dispense Compartment, 4 = Reset All
  uint8_t ultrasonicPanDeg;   // 0..180 deg (SG90 #1)
  uint8_t ultrasonicTiltDeg;  // 0..180 deg (SG90 #2)
  uint8_t cameraPanDeg;       // 0..180 deg (SG90 #6)
  uint8_t compartmentId;      // 1, 2, or 3 (SG90 #3..#5)
  uint8_t compartmentAngle;   // 0 = Closed, 90 = Open
} ServoCommandPacket;

// Optional acknowledgement packet from Board 1 -> Board 2
typedef struct __attribute__((packed)) {
  uint8_t statusOk;           // 1 = Executed
  uint8_t activeCompartment;
  uint8_t ultrasonicPanDeg;
  uint8_t cameraPanDeg;
} ServoAckPacket;

#endif
