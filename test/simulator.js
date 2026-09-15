'use strict';

// Dedektör + router çiftini taklit eden simülatör (gerçek GDSFX haritasına göre).
// Server'a TCP CLIENT olarak bağlanır, gelen FC03 sorgularına float/string
// içeren geçerli CRC'li cevaplar döner.
//
// Kullanım:
//   node test/simulator.js [senaryo] [--host H] [--port P] [--slave N] [--word BE|LE]
// Senaryolar: normal | rising | fault | timeout | disconnect

const net = require('net');
const modbus = require('../src/modbus');

const args = process.argv.slice(2);
const scenario = args.find((a) => !a.startsWith('--')) || 'normal';
function opt(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
}
const HOST = opt('host', '127.0.0.1');
const PORT = Number(opt('port', process.env.PORT_TCP || 5020));
const SLAVE = Number(opt('slave', process.env.MODBUS_SLAVE_ID || 1));
const FLOAT_ORDERS = { ABCD: [0, 1, 2, 3], CDAB: [2, 3, 0, 1], BADC: [1, 0, 3, 2], DCBA: [3, 2, 1, 0] };
let ORDER = String(opt('word', 'BE')).toUpperCase();
if (ORDER === 'BE') ORDER = 'ABCD';
if (ORDER === 'LE') ORDER = 'CDAB';
if (!FLOAT_ORDERS[ORDER]) ORDER = 'ABCD';

console.log(`[sim] senaryo=${scenario} -> ${HOST}:${PORT} (slave ${SLAVE}, word ${ORDER})`);

let t0 = Date.now();

// --- Register image (addr -> uint16) ---
function setU16(img, addr, v) {
  img[addr] = v & 0xffff;
}
function setFloat(img, addr, value) {
  const t = Buffer.alloc(4);
  t.writeFloatBE(value, 0); // gerçek IEEE bayt dizisi [t0,t1,t2,t3]
  // Seçilen order ile "cihazın gönderdiği" ham baytları üret: raw[ord[i]] = t[i]
  const ord = FLOAT_ORDERS[ORDER];
  const raw = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) raw[ord[i]] = t[i];
  img[addr] = (raw[0] << 8) | raw[1];
  img[addr + 1] = (raw[2] << 8) | raw[3];
}
function setStr(img, addr, str, byteLen) {
  const nReg = Math.ceil(byteLen / 2);
  const buf = Buffer.alloc(nReg * 2);
  buf.write(str.slice(0, byteLen), 0, 'ascii');
  for (let i = 0; i < nReg; i++) img[addr + i] = buf.readUInt16BE(i * 2);
}

// Senaryoya göre güncel register image üret.
function buildImage() {
  const elapsed = (Date.now() - t0) / 1000;
  const img = {};

  // Statik cihaz bilgisi
  setStr(img, 0x0032, 'METHANOL', 8); // TARGET_GAS
  setFloat(img, 0x0036, 100); // FULL_SCALE
  setStr(img, 0x0038, '%LEL', 4); // GAS_UNIT
  setU16(img, 0x003a, 1); // TEMP_UNIT: Celsius
  setU16(img, 0x003b, 1); // SENSOR_TYPE: Katalitik

  // Varsayılan durum
  let gas = 3;
  let temp = 25 + Math.sin(elapsed / 8) * 1.5;
  let monitorState = 2; // DÖNGÜ
  let warning = 0;
  let error = 0;
  let alarm1 = 0;
  let alarm2 = 0;
  let faultRelay = 0;

  switch (scenario) {
    case 'rising':
      gas = Math.min(30, elapsed * 1.5);
      alarm1 = gas >= 10 ? 1 : 0;
      alarm2 = gas >= 20 ? 1 : 0;
      break;
    case 'fault':
      gas = 0;
      monitorState = 3; // HATA
      error = 12; // örnek hata kodu
      faultRelay = 1;
      break;
    case 'normal':
    default:
      gas = 3 + Math.sin(elapsed / 5) * 1.5;
      break;
  }

  setU16(img, 0x001e, monitorState);
  setU16(img, 0x001f, warning);
  setU16(img, 0x0020, error);
  setFloat(img, 0x0028, gas);
  setFloat(img, 0x002a, temp);
  setU16(img, 0x0047, alarm1);
  setU16(img, 0x0048, 10); // ALARM_1_LEVEL
  setU16(img, 0x004b, alarm2);
  setU16(img, 0x004c, 20); // ALARM_2_LEVEL
  setU16(img, 0x004e, faultRelay);
  return img;
}

// FC03 okuma isteğine cevap üret.
function buildResponse(reqFrame) {
  const slave = reqFrame.readUInt8(0);
  const fc = reqFrame.readUInt8(1);
  const addr = reqFrame.readUInt16BE(2);
  const qty = reqFrame.readUInt16BE(4);

  const img = buildImage();
  const byteCount = qty * 2;
  const body = Buffer.alloc(3 + byteCount);
  body.writeUInt8(slave, 0);
  body.writeUInt8(fc, 1);
  body.writeUInt8(byteCount, 2);
  for (let i = 0; i < qty; i++) {
    body.writeUInt16BE((img[addr + i] || 0) & 0xffff, 3 + i * 2);
  }
  return modbus.appendCrc(body);
}

function connectOnce() {
  const socket = net.connect(PORT, HOST, () => console.log('[sim] bağlandı'));
  let buf = Buffer.alloc(0);
  let served = 0;

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8) {
      const frame = buf.subarray(0, 8);
      buf = buf.subarray(8);
      if (!modbus.checkCrc(frame)) {
        console.warn('[sim] gelen istekte CRC hatası, atlanıyor');
        continue;
      }
      if (scenario === 'timeout') continue; // cevap verme
      if (scenario === 'disconnect' && served >= 6) {
        console.log('[sim] disconnect senaryosu: soket kapatılıyor');
        socket.destroy();
        return;
      }
      socket.write(buildResponse(Buffer.from(frame)));
      served++;
    }
  });

  socket.on('close', () => {
    console.log('[sim] bağlantı kapandı');
    if (scenario === 'disconnect') setTimeout(connectOnce, 3000);
  });
  socket.on('error', (err) => {
    console.error('[sim] hata:', err.message);
    if (scenario === 'disconnect') setTimeout(connectOnce, 3000);
  });
}

connectOnce();
