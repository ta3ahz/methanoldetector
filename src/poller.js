'use strict';

const config = require('./config');
const state = require('./state');
const db = require('./db');
const modbus = require('./modbus');
const alarms = require('./alarms');
const tcp = require('./tcpServer');
const registers = require('../registers');

// Bir bloğu (bitişik register grubu) oku, register dizisi döndür.
async function readBlock(block) {
  const req = modbus.buildReadRequest(config.slaveId, block.fc, block.addr, block.qty);
  const resp = await tcp.sendRequest(req, modbus.expectedReadResponseLen(block.qty));
  const p = modbus.parseReadResponse(resp);
  if (p.exception != null) throw new Error(`exception ${p.exception}`);
  return p.registers;
}

// Alan tanımını verilen blok register dizisiyle çöz.
function decodeField(f, regs) {
  switch (f.type) {
    case 'u16':
      return modbus.decodeUint16(regs, f.off);
    case 'i16':
      return modbus.decodeInt16(regs, f.off);
    case 'float':
      return modbus.decodeFloat32(regs, f.off, config.floatOrder);
    case 'bool':
      return modbus.decodeUint16(regs, f.off) !== 0;
    case 'str':
      return modbus.decodeString(regs, f.off, f.bytes);
    default:
      return null;
  }
}

// Belirli bir blok dizisinden, o bloğa ait tüm alanları çöz.
function decodeFieldsForBlock(blockName, regs) {
  const out = {};
  for (const [name, f] of Object.entries(registers.fields)) {
    if (f.block === blockName) out[name] = decodeField(f, regs);
  }
  return out;
}

let deviceInfoConn = null; // hangi bağlantı için cihaz bilgisi okundu (connectedSince)
let lastWrite = { ts: 0, conc: null, temp: null, state: null };

function maybeWriteReading(ts, conc, temp, monitorState) {
  const changed =
    conc !== lastWrite.conc ||
    monitorState !== lastWrite.state ||
    (temp != null && lastWrite.temp != null && Math.abs(temp - lastWrite.temp) >= 0.5);
  const stale = ts - lastWrite.ts >= config.readingMinIntervalS * 1000;
  if (changed || stale) {
    db.insertReading(ts, conc, temp, monitorState);
    lastWrite = { ts, conc, temp, state: monitorState };
  }
}

// Statik cihaz bilgisini bir kez oku (bağlantı başında). Hata kritik değil.
async function loadDeviceInfo() {
  try {
    const regs = await readBlock(registers.blocks.device);
    state.rawDevice = regs; // teşhis için ham
    const d = decodeFieldsForBlock('device', regs);
    state.device.targetGas = d.targetGas || null;
    state.device.fullScale = Number.isFinite(d.fullScale) ? d.fullScale : null;
    state.device.gasUnit = d.gasUnit || null;
    state.device.tempUnit = registers.tempUnitLabel(d.tempUnitCode);
    state.device.sensorType = registers.sensorTypeLabel(d.sensorType);
    deviceInfoConn = state.connectedSince;
  } catch (err) {
    // sonraki poll'da tekrar denenir
  }
}

async function pollOnce() {
  if (!tcp.hasConnection()) {
    evaluateAlarms();
    return;
  }

  try {
    const statusRegs = await readBlock(registers.blocks.status);
    const measRegs = await readBlock(registers.blocks.meas);
    const outputRegs = await readBlock(registers.blocks.output);

    state.rawMeas = measRegs; // teşhis için ham
    const s = decodeFieldsForBlock('status', statusRegs);
    const m = decodeFieldsForBlock('meas', measRegs);
    const o = decodeFieldsForBlock('output', outputRegs);

    const ts = Date.now();
    state.consecutiveTimeouts = 0;
    state.monitorState = s.monitorState;
    state.warningCode = s.warningCode;
    state.errorCode = s.errorCode;
    state.concentration = Number.isFinite(m.concentration) ? m.concentration : null;
    state.temperature = Number.isFinite(m.temperature) ? m.temperature : null;
    state.alarm1Status = o.alarm1Status;
    state.alarm2Status = o.alarm2Status;
    state.faultRelay = o.faultRelay;
    state.statusRaw = s.monitorState;
    state.lastReadingTs = ts;

    maybeWriteReading(ts, state.concentration, state.temperature, state.monitorState);

    if (deviceInfoConn !== state.connectedSince) await loadDeviceInfo();
  } catch (err) {
    if (err.message === 'timeout' || err.message === 'no-socket') {
      state.consecutiveTimeouts++;
    }
    // 'crc'/'busy' timeout sayılmaz
  }

  evaluateAlarms();
}

// Alarm koşullarını topla ve durum makinesine ver.
function evaluateAlarms() {
  const now = Date.now();
  const conc = state.concentration;

  const dataStale =
    state.lastReadingTs == null || now - state.lastReadingTs > config.dataStaleS * 1000;

  // Cihaz kaynaklı arıza: HATA modu VEYA hata kodu VEYA arıza rölesi.
  const deviceFault =
    state.monitorState === registers.MONITOR_STATE_FAULT ||
    (state.errorCode != null && state.errorCode !== 0) ||
    state.faultRelay === true;

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
      active: deviceFault && !dataStale,
      value: state.errorCode ?? state.monitorState,
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
  pollTimer = setInterval(() => {
    pollOnce().catch((e) => console.error('[poll] beklenmeyen hata:', e.message));
  }, config.pollIntervalMs);

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
