'use strict';

// Tüm ortam değişkenleri tek yerde toplanır ve tiplenir.
// Değerler süreç başında bir kez okunur.

function num(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function str(name, def) {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}

const config = {
  // HTTP (Railway atar) ve TCP (Modbus) portları
  httpPort: num('PORT', 3000),
  tcpPort: num('PORT_TCP', 5020),

  // Modbus
  slaveId: num('MODBUS_SLAVE_ID', 1),
  pollIntervalMs: num('POLL_INTERVAL_MS', 5000),
  responseTimeoutMs: num('MODBUS_TIMEOUT_MS', 2000),
  commLossThreshold: num('COMM_LOSS_THRESHOLD', 3), // ardışık timeout sayısı

  // Alarm eşikleri (%LEL)
  alarmLowLel: num('ALARM_LOW_LEL', 10),
  alarmHighLel: num('ALARM_HIGH_LEL', 20),
  dataStaleS: num('DATA_STALE_S', 60),
  alarmRepeatMin: num('ALARM_REPEAT_MIN', 30),

  // Veri yazma: değer değişmese de en fazla bu aralıkta bir kayıt at
  readingMinIntervalS: num('READING_MIN_INTERVAL_S', 60),
  readingRetentionDays: num('READING_RETENTION_DAYS', 90),

  // Bildirim (Telegram)
  telegramBotToken: str('TELEGRAM_BOT_TOKEN', ''),
  telegramChatId: str('TELEGRAM_CHAT_ID', ''),

  // Güvenlik
  dashboardPassword: str('DASHBOARD_PASSWORD', ''),
  allowedSourceIp: str('ALLOWED_SOURCE_IP', ''),
  // Bilinmeyen kaynaktan gelen bağlantıya geçerli cevap için tanınan süre
  authGraceMs: num('AUTH_GRACE_MS', 10000),

  // Depolama
  dbPath: str('DB_PATH', '/data/monitor.db'),
};

module.exports = config;
