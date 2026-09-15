'use strict';

// ==========================================================================
// GDSFX Modbus register haritası — KILAVUZDAN (Bölüm 8, Modbus Protokolü)
// --------------------------------------------------------------------------
// Varsayılanlar: ID=1, Baud=115200, Parite=Yok. Router bu ayarlarla eşleşmeli.
// Tüm okumalar Holding Register (FC03). Ölçümler IEEE-754 float (2 register).
//
// Değişiklik olursa yalnızca bu dosya güncellenir; poller alanları buradan okur.
// ==========================================================================

// Her poll'da okunacak bloklar (bitişik register grupları — az sayıda istek).
// Ayrıca bağlantı başında bir kez okunacak statik 'device' bloğu (once).
const blocks = {
  status: { fc: 3, addr: 0x001e, qty: 3 }, // MONITOR_STATE, WARNING_CODE, ERROR_CODE
  meas: { fc: 3, addr: 0x0028, qty: 4 }, // MEASURED_GAS_VALUE(float), SENSOR_TEMPERATURE(float)
  output: { fc: 3, addr: 0x0047, qty: 8 }, // ALARM_1/2_STATUS/LEVEL, FAULT_RELAY_STATUS
  device: { fc: 3, addr: 0x0032, qty: 10, once: true }, // TARGET_GAS, FULL_SCALE, birim, sensör tipi
};

// Alan tanımları: block içindeki register offset'i + tip.
// type: 'u16' | 'i16' | 'float' | 'bool' | 'str'(bytes ile)
const fields = {
  // status
  monitorState: { block: 'status', off: 0, type: 'u16' }, // 0:BAŞLAT 1:ISINMA 2:DÖNGÜ 3:HATA 4:KALİBRASYON
  warningCode: { block: 'status', off: 1, type: 'u16' },
  errorCode: { block: 'status', off: 2, type: 'u16' },
  // ölçümler
  concentration: { block: 'meas', off: 0, type: 'float' }, // gaz seviyesi (cihaz biriminde, ör. %LEL)
  temperature: { block: 'meas', off: 2, type: 'float' }, // sensör sıcaklığı
  // çıkış / alarm durumları
  alarm1Status: { block: 'output', off: 0, type: 'bool' },
  alarm1Level: { block: 'output', off: 1, type: 'u16' },
  alarm2Status: { block: 'output', off: 4, type: 'bool' },
  alarm2Level: { block: 'output', off: 5, type: 'u16' },
  faultRelay: { block: 'output', off: 7, type: 'bool' },
  // statik cihaz bilgisi (once)
  targetGas: { block: 'device', off: 0, type: 'str', bytes: 8 },
  fullScale: { block: 'device', off: 4, type: 'float' },
  gasUnit: { block: 'device', off: 6, type: 'str', bytes: 4 }, // %vol / %LEL / ppm
  tempUnitCode: { block: 'device', off: 8, type: 'u16' }, // 0:Kelvin 1:Celsius 2:Fahrenheit
  sensorType: { block: 'device', off: 9, type: 'u16' }, // 0:IR 1:Katalitik 2:EC 3:MSM 4:PID
};

const MONITOR_STATE_LABELS = {
  0: 'BAŞLAT',
  1: 'ISINMA',
  2: 'DÖNGÜ',
  3: 'HATA',
  4: 'KALİBRASYON',
};

const SENSOR_TYPE_LABELS = {
  0: 'Kızılötesi',
  1: 'Katalitik',
  2: 'Elektrokimyasal',
  3: 'MSM',
  4: 'PID',
};

const TEMP_UNIT_LABELS = { 0: 'K', 1: '°C', 2: '°F' };

module.exports = {
  info: { id: 1, baud: 115200, parity: 'none' },
  blocks,
  fields,
  monitorStateLabel: (n) => MONITOR_STATE_LABELS[n] ?? `? (${n})`,
  sensorTypeLabel: (n) => SENSOR_TYPE_LABELS[n] ?? `? (${n})`,
  tempUnitLabel: (n) => TEMP_UNIT_LABELS[n] ?? '',
  // Cihaz HATA modu kodu (SENSOR_FAULT için)
  MONITOR_STATE_FAULT: 3,
};
