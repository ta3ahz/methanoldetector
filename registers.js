'use strict';

// ==========================================================================
// GDSFX Modbus register haritası — PLACEHOLDER
// --------------------------------------------------------------------------
// DİKKAT: Bu değerler Karf&Scoot'tan gerçek harita gelene kadar tahmindir.
// Gerçek harita gelince yalnızca bu dosya güncellenecek; kodun geri kalanı
// register tanımlarını buradan okur.
//
// Alan açıklamaları:
//   addr   : register başlangıç adresi
//   fc     : function code (3 = holding, 4 = input register)
//   type   : 'uint16' | 'int16'  (16-bit tek register)
//   scale  : ham değer * scale = mühendislik değeri (varsayılan 1)
//   unit   : gösterim birimi (opsiyonel)
//
// Not: Kod tek slave'e göre yazılı ama harita ileride çoklu dedektöre
// genişletilebilir yapıda (her dedektör için ayrı register bloğu).
// ==========================================================================

module.exports = {
  concentration: { addr: 0x0000, fc: 3, type: 'uint16', scale: 0.1, unit: '%LEL' },
  status: { addr: 0x0002, fc: 3, type: 'uint16' }, // fault/alarm bitleri (ham)

  // status register'ındaki bit anlamları — PLACEHOLDER.
  // Gerçek harita gelince güncellenecek. faultMask ile AND'lenen değer
  // sıfırdan farklıysa SENSOR_FAULT kabul edilir.
  statusBits: {
    faultMask: 0x0001, // örn: bit0 = sensör arızası
    // İleride: warmup, calibration, overrange vb. eklenebilir.
  },
};
