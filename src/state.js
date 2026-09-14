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
  concentration: null, // %LEL (ölçekli)
  statusRaw: null,

  // Modbus sağlık
  consecutiveTimeouts: 0,
  crcErrors: 0,

  // Aktif alarmlar: type -> { state, since, value, lastNotified }
  alarms: {},
};

module.exports = state;
