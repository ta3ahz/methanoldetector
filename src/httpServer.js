'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const state = require('./state');
const db = require('./db');
const alarms = require('./alarms');

const DASHBOARD_HTML = path.join(__dirname, '..', 'public', 'index.html');

// HTTP Basic Auth: /health hariç tüm yollar. Parola tanımlı değilse geç.
function checkAuth(req) {
  if (!config.dashboardPassword) return true;
  const hdr = req.headers.authorization || '';
  const m = hdr.match(/^Basic (.+)$/);
  if (!m) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  const pass = idx >= 0 ? decoded.slice(idx + 1) : decoded;
  return pass === config.dashboardPassword;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function statusPayload() {
  const now = Date.now();
  const stale =
    state.lastReadingTs == null || now - state.lastReadingTs > config.dataStaleS * 1000;
  return {
    connected: state.connected,
    remoteAddress: state.remoteAddress,
    connectedSince: state.connectedSince,
    lastReadingTs: state.lastReadingTs,
    dataStale: stale,
    concentration: state.concentration,
    statusRaw: state.statusRaw,
    consecutiveTimeouts: state.consecutiveTimeouts,
    crcErrors: state.crcErrors,
    activeAlarms: alarms.activeAlarms(),
    thresholds: { low: config.alarmLowLel, high: config.alarmHighLel },
    serverTime: now,
  };
}

function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathName = url.pathname;

  // Healthcheck — auth'suz
  if (pathName === '/health') {
    return json(res, 200, { ok: true, connected: state.connected });
  }

  // Auth
  if (!checkAuth(req)) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="Methanol Monitor"',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    return res.end('Yetkilendirme gerekli');
  }

  if (pathName === '/api/status') {
    return json(res, 200, statusPayload());
  }

  if (pathName === '/api/readings') {
    const to = Number(url.searchParams.get('to')) || Date.now();
    const from = Number(url.searchParams.get('from')) || to - 24 * 3600 * 1000;
    return json(res, 200, db.getReadings(from, to));
  }

  if (pathName === '/api/alarms') {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 1000);
    return json(res, 200, db.getAlarms(limit));
  }

  if (pathName === '/' || pathName === '/index.html') {
    fs.readFile(DASHBOARD_HTML, (err, data) => {
      if (err) {
        res.writeHead(500);
        return res.end('dashboard yüklenemedi');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('bulunamadı');
}

function start() {
  const server = http.createServer(handle);
  server.listen(config.httpPort, () => {
    console.log(`[http] dashboard/API dinliyor: ${config.httpPort}`);
  });
  return server;
}

module.exports = { start, statusPayload };
