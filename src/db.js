'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('./config');

// DB dosyasının klasörünü garanti et (Railway volume: /data).
// Volume mount edilmemişse (lokal test) yolun klasörünü oluşturmayı dene;
// olmazsa çalışılan dizine düş.
function resolveDbPath() {
  const p = config.dbPath;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    return p;
  } catch (err) {
    const fallback = path.join(process.cwd(), 'monitor.db');
    console.warn(`[db] ${p} kullanılamadı (${err.code}); fallback: ${fallback}`);
    return fallback;
  }
}

const db = new Database(resolveDbPath());
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    ts INTEGER NOT NULL,            -- epoch ms
    concentration REAL,             -- gaz seviyesi (cihaz birimi)
    status_raw INTEGER              -- monitorState (cihaz modu)
  );
  CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings(ts);

  CREATE TABLE IF NOT EXISTS alarms (
    ts INTEGER NOT NULL,
    type TEXT NOT NULL,             -- GAS_HIGH, GAS_LOW, SENSOR_FAULT, COMM_LOSS, LINK_DOWN
    state TEXT NOT NULL,            -- ACTIVE | CLEARED
    value REAL
  );
  CREATE INDEX IF NOT EXISTS idx_alarms_ts ON alarms(ts);

  CREATE TABLE IF NOT EXISTS events (
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,            -- CONNECT, DISCONNECT, CRC_ERROR, INFO
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
`);

// Migrasyon: eski DB'lerde 'temperature' kolonu yoksa ekle.
const hasTemp = db
  .prepare("PRAGMA table_info(readings)")
  .all()
  .some((c) => c.name === 'temperature');
if (!hasTemp) {
  db.exec('ALTER TABLE readings ADD COLUMN temperature REAL');
}

const stmts = {
  insReading: db.prepare(
    'INSERT INTO readings (ts, concentration, temperature, status_raw) VALUES (?, ?, ?, ?)'
  ),
  insAlarm: db.prepare(
    'INSERT INTO alarms (ts, type, state, value) VALUES (?, ?, ?, ?)'
  ),
  insEvent: db.prepare('INSERT INTO events (ts, kind, detail) VALUES (?, ?, ?)'),
  readingsRange: db.prepare(
    'SELECT ts, concentration, temperature, status_raw FROM readings WHERE ts BETWEEN ? AND ? ORDER BY ts ASC'
  ),
  recentAlarms: db.prepare(
    'SELECT ts, type, state, value FROM alarms ORDER BY ts DESC LIMIT ?'
  ),
  pruneReadings: db.prepare('DELETE FROM readings WHERE ts < ?'),
};

module.exports = {
  db,
  insertReading(ts, concentration, temperature, statusRaw) {
    stmts.insReading.run(ts, concentration, temperature ?? null, statusRaw ?? null);
  },
  insertAlarm(ts, type, state, value) {
    stmts.insAlarm.run(ts, type, state, value ?? null);
  },
  insertEvent(ts, kind, detail) {
    stmts.insEvent.run(ts, kind, detail ?? null);
  },
  getReadings(from, to) {
    return stmts.readingsRange.all(from, to);
  },
  getAlarms(limit = 100) {
    return stmts.recentAlarms.all(limit);
  },
  pruneOldReadings() {
    const cutoff = Date.now() - config.readingRetentionDays * 86400000;
    const info = stmts.pruneReadings.run(cutoff);
    return info.changes;
  },
};
