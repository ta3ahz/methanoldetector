'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const state = require('./state');
const db = require('./db');
const alarms = require('./alarms');
const registers = require('../registers');
const modbus = require('./modbus');

const DASHBOARD_HTML = path.join(__dirname, '..', 'public', 'index.html');

// Geçerli oturum token'ları (tek replika; restart'ta sıfırlanır, yeniden giriş gerekir).
const sessions = new Set();

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie || '';
  h.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// Kimlik doğrulama: parola tanımsızsa herkese açık. Aksi halde ya geçerli oturum
// cookie'si ya da Basic Auth (curl/script için) gerekir.
function isAuthed(req) {
  if (!config.dashboardPassword) return true;
  const hdr = req.headers.authorization || '';
  const m = hdr.match(/^Basic (.+)$/);
  if (m) {
    const dec = Buffer.from(m[1], 'base64').toString('utf8');
    const pass = dec.slice(dec.indexOf(':') + 1);
    if (pass === config.dashboardPassword) return true;
  }
  const c = parseCookies(req);
  if (c.session && sessions.has(c.session)) return true;
  return false;
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function loginPage(errorMsg) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Giriş — Metanol Dedektörü</title>
<style>
  body{margin:0;font:15px system-ui,sans-serif;background:#0f1115;color:#e6e8ec;
    display:flex;min-height:100vh;align-items:center;justify-content:center}
  form{background:#1a1d24;border:1px solid #2a2e38;border-radius:12px;padding:28px;width:300px}
  h1{font-size:16px;margin:0 0 4px}
  p{color:#8b90a0;font-size:12px;margin:0 0 18px}
  input{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #2a2e38;
    background:#0f1115;color:#e6e8ec;font-size:14px;margin-bottom:12px}
  button{width:100%;padding:10px;border:0;border-radius:8px;background:#2563eb;color:#fff;
    font-size:14px;font-weight:600;cursor:pointer}
  .err{color:#f87171;font-size:12px;margin-bottom:12px}
</style></head><body>
<form method="POST" action="/login">
  <h1>Metanol Dedektörü İzleme</h1>
  <p>Devam etmek için parolayı girin.</p>
  ${errorMsg ? `<div class="err">${errorMsg}</div>` : ''}
  <input type="password" name="password" placeholder="Parola" autofocus autocomplete="current-password">
  <button type="submit">Giriş</button>
</form></body></html>`;
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
    temperature: state.temperature,
    monitorState: state.monitorState,
    monitorStateLabel:
      state.monitorState == null ? null : registers.monitorStateLabel(state.monitorState),
    warningCode: state.warningCode,
    errorCode: state.errorCode,
    alarm1Status: state.alarm1Status,
    alarm2Status: state.alarm2Status,
    faultRelay: state.faultRelay,
    device: state.device,
    statusRaw: state.statusRaw,
    consecutiveTimeouts: state.consecutiveTimeouts,
    crcErrors: state.crcErrors,
    activeAlarms: alarms.activeAlarms(),
    thresholds: { low: config.alarmLowLel, high: config.alarmHighLel },
    serverTime: now,
  };
}

function handleLogin(req, res) {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 4096) req.destroy();
    });
    req.on('end', () => {
      const params = new URLSearchParams(body);
      if (params.get('password') === config.dashboardPassword) {
        const token = crypto.randomBytes(24).toString('hex');
        sessions.add(token);
        res.writeHead(302, {
          'Set-Cookie': `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`,
          Location: '/',
        });
        res.end();
      } else {
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(loginPage('Hatalı parola'));
      }
    });
    return;
  }
  // GET: parola yoksa doğrudan ana sayfaya
  if (!config.dashboardPassword) {
    res.writeHead(302, { Location: '/' });
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(loginPage());
}

function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathName = url.pathname;

  // Healthcheck — auth'suz
  if (pathName === '/health') {
    return json(res, 200, { ok: true, connected: state.connected });
  }

  // Giriş sayfası — auth'suz
  if (pathName === '/login') {
    return handleLogin(req, res);
  }

  // Buradan sonrası auth ister
  if (!isAuthed(req)) {
    // Sayfa isteğinde giriş ekranına yönlendir; API isteğinde 401 dön
    if (pathName.startsWith('/api')) {
      return json(res, 401, { error: 'unauthorized' });
    }
    res.writeHead(302, { Location: '/login' });
    return res.end();
  }

  if (pathName === '/api/status') {
    return json(res, 200, statusPayload());
  }

  if (pathName === '/api/readings') {
    const to = Number(url.searchParams.get('to')) || Date.now();
    const from = Number(url.searchParams.get('from')) || to - 24 * 3600 * 1000;
    return json(res, 200, db.getReadings(from, to));
  }

  // Teşhis: ham register'lar ve 4 float order ile çözümleri (word order tanısı)
  if (pathName === '/api/raw') {
    const orders = ['ABCD', 'CDAB', 'BADC', 'DCBA'];
    const hex = (regs) =>
      regs ? regs.map((r) => '0x' + (r & 0xffff).toString(16).padStart(4, '0')) : null;
    const interp = (regs, off) => {
      if (!regs) return null;
      const o = {};
      for (const ord of orders) o[ord] = Number(modbus.decodeFloat32(regs, off, ord).toPrecision(6));
      return o;
    };
    return json(res, 200, {
      activeOrder: config.floatOrder,
      rawMeas: hex(state.rawMeas),
      rawDevice: hex(state.rawDevice),
      concentration_orders: interp(state.rawMeas, 0),
      temperature_orders: interp(state.rawMeas, 2),
      fullScale_orders: interp(state.rawDevice, 4),
      hint: 'fullScale 100 olmalı; hangi order 100 veriyorsa doğru order odur',
    });
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
