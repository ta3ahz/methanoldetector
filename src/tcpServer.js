'use strict';

const net = require('net');
const config = require('./config');
const state = require('./state');
const db = require('./db');
const modbus = require('./modbus');

// TCP server: router (TCP client) buraya bağlanır. Biz Modbus master olarak
// istek gönderir, cevabı bekleriz. Tek eşzamanlı bağlantı; yeni bağlantı
// gelirse eskisini kapatırız.

let activeSocket = null;
let pending = null; // { expectedLen, resolve, reject, timer, buffer }

function now() {
  return Date.now();
}

function logEvent(kind, detail) {
  db.insertEvent(now(), kind, detail);
}

// Aktif sokete istek gönder, CRC-doğrulanmış cevap çerçevesini döndür.
// Reddetme sebepleri: 'no-socket', 'timeout', 'crc'.
function sendRequest(frame, expectedLen) {
  return new Promise((resolve, reject) => {
    if (!activeSocket || activeSocket.destroyed) {
      reject(new Error('no-socket'));
      return;
    }
    if (pending) {
      reject(new Error('busy'));
      return;
    }

    const timer = setTimeout(() => {
      if (pending) {
        const p = pending;
        pending = null;
        p.reject(new Error('timeout'));
      }
    }, config.responseTimeoutMs);

    pending = { expectedLen, resolve, reject, timer, buffer: Buffer.alloc(0) };
    activeSocket.write(frame);
  });
}

// Gelen baytları biriktirip bekleyen isteğe eşle.
function onData(chunk) {
  if (!pending) {
    // Beklenmeyen veri (spontane çerçeve olmamalı); yoksay.
    return;
  }
  pending.buffer = Buffer.concat([pending.buffer, chunk]);
  const res = modbus.tryExtractFrame(pending.buffer, pending.expectedLen);
  if (!res) return; // daha fazla bayt bekle

  const p = pending;
  pending = null;
  clearTimeout(p.timer);

  if (!res.crcOk) {
    state.crcErrors++;
    logEvent('CRC_ERROR', `beklenen ${p.expectedLen} bayt, CRC hatalı`);
    p.reject(new Error('crc'));
    return;
  }
  p.resolve(res.frame);
}

function attachSocket(socket) {
  // Eski bağlantıyı kapat
  if (activeSocket && !activeSocket.destroyed) {
    logEvent('DISCONNECT', 'yeni bağlantı için eski soket kapatıldı');
    activeSocket.destroy();
  }
  // Bekleyen isteği iptal et
  if (pending) {
    clearTimeout(pending.timer);
    const p = pending;
    pending = null;
    p.reject(new Error('no-socket'));
  }

  activeSocket = socket;
  socket.setKeepAlive(true, 30000);
  socket.setNoDelay(true);

  const remote = socket.remoteAddress;
  state.connected = true;
  state.remoteAddress = remote;
  state.connectedSince = now();
  state.consecutiveTimeouts = 0;

  // Basit kimlik doğrulama: grace süresi içinde geçerli cevap gelmezse kapat.
  const authTimer = setTimeout(() => {
    if (state.lastReadingTs == null || state.lastReadingTs < state.connectedSince) {
      logEvent('DISCONNECT', `kimlik doğrulama başarısız (${config.authGraceMs}ms içinde geçerli cevap yok)`);
      socket.destroy();
    }
  }, config.authGraceMs);

  socket.on('data', onData);

  socket.on('close', () => {
    clearTimeout(authTimer);
    if (activeSocket === socket) {
      activeSocket = null;
      state.connected = false;
      logEvent('DISCONNECT', `bağlantı kapandı (${remote})`);
    }
  });

  socket.on('error', (err) => {
    logEvent('INFO', `soket hatası: ${err.message}`);
  });

  logEvent('CONNECT', `bağlantı kuruldu (${remote})`);
}

function start() {
  const server = net.createServer((socket) => {
    const remote = socket.remoteAddress;
    // Opsiyonel IP kısıtı (LTE NAT nedeniyle her zaman güvenilir değil)
    if (config.allowedSourceIp && !String(remote).includes(config.allowedSourceIp)) {
      logEvent('INFO', `izin verilmeyen IP reddedildi: ${remote}`);
      socket.destroy();
      return;
    }
    attachSocket(socket);
  });

  server.on('error', (err) => {
    console.error(`[tcp] server hatası: ${err.message}`);
  });

  server.listen(config.tcpPort, () => {
    console.log(`[tcp] Modbus TCP server dinliyor: ${config.tcpPort}`);
  });

  return server;
}

module.exports = { start, sendRequest, hasConnection: () => !!activeSocket };
