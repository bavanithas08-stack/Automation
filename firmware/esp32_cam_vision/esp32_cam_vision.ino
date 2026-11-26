/*
 * ESP32-CAM Vision Unit — AI Face Detection & Recognition
 * Board: AI-Thinker ESP32-CAM
 *
 * Role in System Architecture:
 * - Captures frames from OV2640 camera and compares detected faces against
 *   the registered patient's reference face.
 * - Outputs binary verification result over UART & GPIO:
 *     1 = Match (Registered patient verified)
 *     0 = No Match
 */

#include "esp_camera.h"
#include <WiFi.h>

// Replace with your Wi-Fi credentials if streaming camera status to dashboard
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// GPIO output sent to ESP8266 Board 2 (HIGH = 1 Match, LOW = 0 No Match)
#define MATCH_SIGNAL_PIN 12
#define FLASH_LED_PIN     4

// AI-Thinker ESP32-CAM Pin Definitions
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

int registeredFaceId = 1;
int lastMatchResult = 0;

bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAMESIZE_QVGA;
  config.jpeg_quality = 12;
  config.fb_count = 1;

  return esp_camera_init(&config) == ESP_OK;
}

/*
 * Face recognition evaluation hook.
 * Integrate Espressif's ESP-WHO / human_face_recognition model (from the
 * standard ESP32 CameraWebServer example) to compare the captured frame's
 * face embedding against the enrolled patient reference vector.
 * Returns: 1 = Match, 0 = No Match.
 */
int runPatientFaceVerification(camera_fb_t* fb) {
  if (!fb || fb->len == 0) {
    return 0;
  }
  // Placeholder hook for ESP-WHO face_recognizer.recognize(image_matrix, boxes):
  // When enrolled face ID == registeredFaceId, return 1; otherwise return 0.
  // For serial bench testing, sending '1' or '0' on UART overrides the result.
  if (Serial.available()) {
    char cmd = Serial.read();
    if (cmd == '1') return 1;
    if (cmd == '0') return 0;
  }
  return lastMatchResult;
}

void publishVerificationSignal(int matchResult) {
  lastMatchResult = (matchResult == 1) ? 1 : 0;
  digitalWrite(MATCH_SIGNAL_PIN, lastMatchResult ? HIGH : LOW);
  // Emit structured single-digit line over UART for ESP8266 Board 2
  Serial.println(lastMatchResult);
}

void setup() {
  Serial.begin(115200);
  pinMode(MATCH_SIGNAL_PIN, OUTPUT);
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(MATCH_SIGNAL_PIN, LOW);

  if (!initCamera()) {
    Serial.println("ERR:CAM_INIT_FAILED");
    return;
  }

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 6000) {
    delay(250);
  }
  Serial.println("ESP32-CAM READY (1=Match, 0=No Match)");
}

void loop() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (fb) {
    int match = runPatientFaceVerification(fb);
    publishVerificationSignal(match);
    esp_camera_fb_return(fb);
  }
  delay(250);
}
