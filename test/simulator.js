'use strict';

// Dedektör + router çiftini taklit eden simülatör.
// Server'a TCP CLIENT olarak bağlanır (router "Pure TCP client" gibi),
// gelen Modbus RTU sorgularına geçerli CRC'li cevaplar döner.
//
// Kullanım:
//   node test/simulator.js [senaryo] [--host H] [--port P] [--slave N]
// Senaryolar: normal | rising | fault | timeout | disconnect
//
// Not: register adresleri ../registers.js ile aynı varsayılır.

const net = require('net');
const modbus = require('../src/modbus');
const registers = require('../registers');

const args = process.argv.slice(2);
const scenario = args.find((a) => !a.startsWith('--')) || 'normal';
function opt(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
}
const HOST = opt('host', '127.0.0.1');
const PORT = Number(opt('port', process.env.PORT_TCP || 5020));
const SLAVE = Number(opt('slave', process.env.MODBUS_SLAVE_ID || 1));

console.log(`[sim] senaryo=${scenario} -> ${HOST}:${PORT} (slave ${SLAVE})`);

let t0 = Date.now();

// Senaryoya göre anlık ham register değerlerini üret.
function currentValues() {
  const elapsed = (Date.now() - t0) / 1000;
  const faultMask = registers.statusBits?.faultMask ?? 0x0001;
  let concLel = 3; // %LEL
  let status = 0;

  switch (scenario) {
    case 'rising':
      // 0'dan başlayıp ~30 %LEL'e tırman (low@10, high@20 tetiklenir)
      concLel = Math.min(30, elapsed * 1.5);
      break;
    case 'fault':
      concLel = 0; // zehirlenmiş katalitik sensör 0 okuyabilir
      status = faultMask;
      break;
    case 'normal':
    default:
      concLel = 3 + Math.sin(elapsed / 5) * 1.5;
      break;
  }

  const scale = registers.concentration.scale ?? 1;
  const concRaw = Math.max(0, Math.round(concLel / scale)) & 0xffff;
  return { concRaw, status };
}

// Bir istek çerçevesine cevap üret. addr'a göre doğru register döner.
function buildResponse(reqFrame) {
  const slave = reqFrame.readUInt8(0);
  const fc = reqFrame.readUInt8(1);
  const addr = reqFrame.readUInt16BE(2);
  const qty = reqFrame.readUInt16BE(4);

  const { concRaw, status } = currentValues();

  // Talep edilen adrese göre değer seç (basit tekli register varsayımı)
  const values = [];
  for (let i = 0; i < qty; i++) {
    const a = addr + i;
    if (a === registers.concentration.addr) values.push(concRaw);
    else if (a === registers.status.addr) values.push(status);
    else values.push(0);
  }

  const byteCount = qty * 2;
  const body = Buffer.alloc(3 + byteCount);
  body.writeUInt8(slave, 0);
  body.writeUInt8(fc, 1);
  body.writeUInt8(byteCount, 2);
  values.forEach((v, i) => body.writeUInt16BE(v & 0xffff, 3 + i * 2));
  return modbus.appendCrc(body);
}

function connectOnce() {
  const socket = net.connect(PORT, HOST, () => {
    console.log('[sim] bağlandı');
  });

  let buf = Buffer.alloc(0);
  let served = 0;

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    // İstek çerçevesi FC03/04 okuma için sabit 8 bayt
    while (buf.length >= 8) {
      const frame = buf.subarray(0, 8);
      buf = buf.subarray(8);
      if (!modbus.checkCrc(frame)) {
        console.warn('[sim] gelen istekte CRC hatası, atlanıyor');
        continue;
      }

      if (scenario === 'timeout') {
        // Hiç cevap verme
        continue;
      }
      if (scenario === 'disconnect' && served >= 3) {
        console.log('[sim] disconnect senaryosu: soket kapatılıyor');
        socket.destroy();
        return;
      }

      const resp = buildResponse(Buffer.from(frame));
      socket.write(resp);
      served++;
    }
  });

  socket.on('close', () => {
    console.log('[sim] bağlantı kapandı');
    if (scenario === 'disconnect') {
      setTimeout(connectOnce, 3000); // router reconnect taklidi
    }
  });

  socket.on('error', (err) => {
    console.error('[sim] hata:', err.message);
    if (scenario === 'disconnect') setTimeout(connectOnce, 3000);
  });
}

connectOnce();
