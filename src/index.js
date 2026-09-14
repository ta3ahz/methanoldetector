'use strict';

const config = require('./config');
const tcpServer = require('./tcpServer');
const httpServer = require('./httpServer');
const poller = require('./poller');
const alarms = require('./alarms');
const { buildNotifier } = require('./notifier');

console.log('=== Metanol Gaz Dedektörü İzleme Sistemi ===');
console.log(`HTTP portu: ${config.httpPort} | TCP (Modbus) portu: ${config.tcpPort}`);
console.log(`Slave ID: ${config.slaveId} | Poll: ${config.pollIntervalMs}ms`);
console.log('UYARI: Bu sistem ikincil izleme katmanıdır. Birincil emniyet');
console.log('fonksiyonu dedektörün lokal röle çıkışlarındadır.');

const notifier = buildNotifier();
console.log(`Bildirim kanalları: ${notifier.channels.join(', ')}`);
alarms.setNotifier(notifier);

tcpServer.start();
httpServer.start();
poller.start();

function shutdown(sig) {
  console.log(`\n${sig} alındı, kapatılıyor...`);
  poller.stop();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
