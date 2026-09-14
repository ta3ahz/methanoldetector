'use strict';

const config = require('./config');
const state = require('./state');
const db = require('./db');
const modbus = require('./modbus');
const alarms = require('./alarms');
const tcp = require('./tcpServer');
const registers = require('../registers');

// Değeri ölçekle ve tipe uydur.
function decode(reg, raw) {
  let v = raw;
  if (reg.type === 'int16' && raw > 0x7fff) v = raw - 0x10000;
  return v * (reg.scale ?? 1);
}

let lastWrittenTs = 0;
let lastWrittenConc = null;

// Okumayı DB'ye yaz: değer değiştiğinde veya min aralık dolduğunda.
function maybeWriteReading(ts, conc, statusRaw) {
  const changed = conc !== lastWrittenConc;
  const stale = ts - lastWrittenTs >= config.readingMinIntervalS * 1000;
  if (changed || stale) {
    db.insertReading(ts, conc, statusRaw);
    lastWrittenTs = ts;
    lastWrittenConc = conc;
  }
}

// Tek poll döngüsü: concentration + status oku.
async function pollOnce() {
  if (!tcp.hasConnection()) {
    // Bağlantı yoksa Modbus denemesi yapma; alarmları yine değerlendir.
    evaluateAlarms();
    return;
  }

  const concReg = registers.concentration;
  const statusReg = registers.status;

  try {
    // concentration
    const req1 = modbus.buildReadRequest(config.slaveId, concReg.fc, concReg.addr, 1);
    const resp1 = await tcp.sendRequest(req1, modbus.expectedReadResponseLen(1));
    const p1 = modbus.parseReadResponse(resp1);
    if (p1.exception != null) throw new Error(`exception ${p1.exception}`);
    const conc = decode(concReg, p1.registers[0]);

    // status
    const req2 = modbus.buildReadRequest(config.slaveId, statusReg.fc, statusReg.addr, 1);
    const resp2 = await tcp.sendRequest(req2, modbus.expectedReadResponseLen(1));
    const p2 = modbus.parseReadResponse(resp2);
    if (p2.exception != null) throw new Error(`exception ${p2.exception}`);
    const statusRaw = p2.registers[0];

    // Başarılı okuma
    const ts = Date.now();
    state.consecutiveTimeouts = 0;
    state.concentration = conc;
    state.statusRaw = statusRaw;
    state.lastReadingTs = ts;
    maybeWriteReading(ts, conc, statusRaw);
  } catch (err) {
    if (err.message === 'timeout' || err.message === 'no-socket') {
      state.consecutiveTimeouts++;
    }
    // 'crc' ve 'busy' hataları timeout sayılmaz; yalnızca loglanır (crc DB'de).
  }

  evaluateAlarms();
}

// Tüm alarm koşullarını topla ve durum makinesine ver.
function evaluateAlarms() {
  const now = Date.now();
  const conc = state.concentration;
  const statusRaw = state.statusRaw;
  const faultMask = registers.statusBits?.faultMask ?? 0;

  const dataStale =
    state.lastReadingTs == null || now - state.lastReadingTs > config.dataStaleS * 1000;

  const conditions = {
    GAS_HIGH: {
      active: conc != null && conc >= config.alarmHighLel && !dataStale,
      value: conc,
    },
    GAS_LOW: {
      active: conc != null && conc >= config.alarmLowLel && !dataStale,
      value: conc,
    },
    SENSOR_FAULT: {
      active: statusRaw != null && (statusRaw & faultMask) !== 0 && !dataStale,
      value: statusRaw,
    },
    COMM_LOSS: {
      active: state.consecutiveTimeouts >= config.commLossThreshold,
      value: state.consecutiveTimeouts,
    },
    LINK_DOWN: {
      active: !state.connected || dataStale,
      value: null,
    },
  };

  alarms.evaluate(conditions);
}

let pollTimer = null;
let pruneTimer = null;

function start() {
  // İlk poll'u hemen değil, kısa gecikmeyle başlat
  pollTimer = setInterval(() => {
    pollOnce().catch((e) => console.error('[poll] beklenmeyen hata:', e.message));
  }, config.pollIntervalMs);

  // Günlük eski kayıt temizliği
  pruneTimer = setInterval(() => {
    const n = db.pruneOldReadings();
    if (n) console.log(`[db] ${n} eski reading kaydı silindi`);
  }, 86400000);

  console.log(`[poll] polling başladı (${config.pollIntervalMs}ms)`);
}

function stop() {
  if (pollTimer) clearInterval(pollTimer);
  if (pruneTimer) clearInterval(pruneTimer);
}

module.exports = { start, stop, pollOnce, evaluateAlarms };
