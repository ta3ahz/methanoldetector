'use strict';

// Modbus RTU (over TCP) yardımcıları — MBAP header YOK, CRC16 VAR.
// Çerçeve: [slaveId][fc][data...][CRC16-lo][CRC16-hi]

// CRC16-MODBUS: poly 0xA001, init 0xFFFF, little-endian eklenir.
function crc16(buf) {
  let crc = 0xffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let b = 0; b < 8; b++) {
      if (crc & 0x0001) {
        crc >>= 1;
        crc ^= 0xa001;
      } else {
        crc >>= 1;
      }
    }
  }
  return crc & 0xffff;
}

// Verilen gövdeye (slaveId..data) CRC ekleyip tam çerçeve döndürür.
function appendCrc(body) {
  const crc = crc16(body);
  const out = Buffer.alloc(body.length + 2);
  body.copy(out, 0);
  out.writeUInt16LE(crc, body.length);
  return out;
}

// Çerçevenin son 2 baytı CRC. Doğruysa true.
function checkCrc(frame) {
  if (frame.length < 4) return false;
  const body = frame.subarray(0, frame.length - 2);
  const given = frame.readUInt16LE(frame.length - 2);
  return crc16(body) === given;
}

// FC03/FC04 okuma isteği kur: [slave][fc][addrHi][addrLo][qtyHi][qtyLo][crc]
function buildReadRequest(slaveId, fc, addr, quantity) {
  const body = Buffer.alloc(6);
  body.writeUInt8(slaveId, 0);
  body.writeUInt8(fc, 1);
  body.writeUInt16BE(addr, 2);
  body.writeUInt16BE(quantity, 4);
  return appendCrc(body);
}

// FC03/FC04 okuma cevabının beklenen toplam çerçeve uzunluğu (bayt).
// [slave][fc][byteCount][data...][crc-lo][crc-hi] => 3 + byteCount + 2
function expectedReadResponseLen(quantity) {
  return 3 + quantity * 2 + 2;
}

// Bir okuma cevabını parse et. Doğrulanmış CRC'li tam çerçeve beklenir.
// Dönen: { slaveId, fc, registers: number[] }  veya exception ise { exception }
function parseReadResponse(frame) {
  const slaveId = frame.readUInt8(0);
  const fc = frame.readUInt8(1);
  // Exception cevabı: fc | 0x80, ardından exception kodu
  if (fc & 0x80) {
    return { slaveId, fc: fc & 0x7f, exception: frame.readUInt8(2) };
  }
  const byteCount = frame.readUInt8(2);
  const registers = [];
  for (let i = 0; i < byteCount / 2; i++) {
    registers.push(frame.readUInt16BE(3 + i * 2));
  }
  return { slaveId, fc, registers };
}

// Buffer'dan beklenen uzunlukta bir çerçeve çıkarmayı dene.
// Kısmi paket => null (daha fazla bayt bekle).
// Yeterli bayt varsa: { frame, rest, crcOk }.
//   frame : ilk expectedLen bayt
//   rest  : arta kalan baytlar (bitişik ikinci çerçevenin başı olabilir)
//   crcOk : frame'in CRC doğrulaması
function tryExtractFrame(buffer, expectedLen) {
  if (buffer.length < expectedLen) return null;
  const frame = buffer.subarray(0, expectedLen);
  const rest = buffer.subarray(expectedLen);
  return { frame: Buffer.from(frame), rest: Buffer.from(rest), crcOk: checkCrc(frame) };
}

// --- Register dizisinden değer çözücüler ---
// registers: parseReadResponse().registers (uint16 dizisi, big-endian register'lar)

function decodeUint16(registers, off) {
  return registers[off];
}

function decodeInt16(registers, off) {
  const v = registers[off];
  return v > 0x7fff ? v - 0x10000 : v;
}

// IEEE-754 float32, 2 register. highWordFirst=true => ABCD (ilk register üst word).
// Cihaza göre word sırası değişebilir; commissioning'de env ile ters çevrilebilir.
function decodeFloat32(registers, off, highWordFirst = true) {
  const buf = Buffer.alloc(4);
  const a = registers[off];
  const b = registers[off + 1];
  if (highWordFirst) {
    buf.writeUInt16BE(a & 0xffff, 0);
    buf.writeUInt16BE(b & 0xffff, 2);
  } else {
    buf.writeUInt16BE(b & 0xffff, 0);
    buf.writeUInt16BE(a & 0xffff, 2);
  }
  return buf.readFloatBE(0);
}

// String: her register 2 bayt (big-endian), byteLen bayt oku, null/boşluk kırp.
function decodeString(registers, off, byteLen) {
  const nReg = Math.ceil(byteLen / 2);
  const buf = Buffer.alloc(nReg * 2);
  for (let i = 0; i < nReg; i++) buf.writeUInt16BE((registers[off + i] || 0) & 0xffff, i * 2);
  return buf.subarray(0, byteLen).toString('ascii').replace(/\0+/g, '').trim();
}

module.exports = {
  crc16,
  appendCrc,
  checkCrc,
  buildReadRequest,
  expectedReadResponseLen,
  parseReadResponse,
  tryExtractFrame,
  decodeUint16,
  decodeInt16,
  decodeFloat32,
  decodeString,
};
