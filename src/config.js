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
  // Port stratejisi (Railway uyumlu):
  //   - Railway TCP Proxy, trafiği konteynerin `PORT` değişkenine yönlendirir.
  //     Bu yüzden Modbus TCP server `PORT`'u kullanır (yoksa PORT_TCP, yoksa 5020).
  //   - HTTP dashboard ayrı bir `HTTP_PORT` (varsayılan 8080) kullanır; böylece
  //     Railway `PORT`'u TCP için değiştirse bile iki server çakışmaz.
  httpPort: num('HTTP_PORT', 8080),
  tcpPort: num('PORT', num('PORT_TCP', 5020)),

  // Modbus
  slaveId: num('MODBUS_SLAVE_ID', 1),
  pollIntervalMs: num('POLL_INTERVAL_MS', 5000),
  // float32 bayt sırası. 'BE'=ABCD (standart), 'LE'=CDAB (word swap), ayrıca
  // 'BADC'/'DCBA' desteklenir. Cihaza göre değerler saçma gelirse denenir.
  floatOrder: (() => {
    let o = str('MODBUS_FLOAT_WORD_ORDER', 'ABCD').toUpperCase();
    if (o === 'BE') o = 'ABCD';
    if (o === 'LE') o = 'CDAB';
    return ['ABCD', 'CDAB', 'BADC', 'DCBA'].includes(o) ? o : 'ABCD';
  })(),
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
  // Bilinmeyen kaynaktan gelen bağlantıya geçerli cevap için tanınan süre.
  // 0 = devre dışı (bağlantı geçerli cevap gelmese de koparılmaz).
  authGraceMs: num('AUTH_GRACE_MS', 0),

  // Depolama
  dbPath: str('DB_PATH', '/data/monitor.db'),
};

module.exports = config;
