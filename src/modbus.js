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

module.exports = {
  crc16,
  appendCrc,
  checkCrc,
  buildReadRequest,
  expectedReadResponseLen,
  parseReadResponse,
  tryExtractFrame,
};
