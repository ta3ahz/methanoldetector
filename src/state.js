'use strict';

// Uygulamanın canlı (bellek içi) durumu. API bunu okur.
// Tek dedektör / tek bağlantı varsayımıyla singleton.

const state = {
  // Bağlantı
  connected: false,
  remoteAddress: null,
  connectedSince: null,

  // Son okuma
  lastReadingTs: null, // epoch ms
  concentration: null, // gaz seviyesi (cihaz birimi)
  temperature: null, // sensör sıcaklığı
  monitorState: null, // 0..4 (BAŞLAT/ISINMA/DÖNGÜ/HATA/KALİBRASYON)
  warningCode: null,
  errorCode: null,
  alarm1Status: null, // cihazın kendi Alarm 1 rölesi
  alarm2Status: null, // cihazın kendi Alarm 2 rölesi
  faultRelay: null, // cihazın arıza rölesi
  statusRaw: null, // geriye dönük: monitorState saklanır

  // Statik cihaz bilgisi (bağlantı başında bir kez okunur)
  device: {
    targetGas: null,
    fullScale: null,
    gasUnit: null, // %LEL / %vol / ppm
    tempUnit: null, // °C / °F / K
    sensorType: null, // metin etiket
  },

  // Modbus sağlık
  consecutiveTimeouts: 0,
  crcErrors: 0,

  // Aktif alarmlar: type -> { state, since, value, lastNotified }
  alarms: {},
};

module.exports = state;
