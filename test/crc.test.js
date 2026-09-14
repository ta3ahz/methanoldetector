'use strict';

const test = require('node:test');
const assert = require('node:assert');
const modbus = require('../src/modbus');

test('CRC16-MODBUS bilinen vektör: 01 03 00 00 00 01 -> 84 0A', () => {
  const body = Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x01]);
  const crc = modbus.crc16(body);
  // little-endian: lo=0x84, hi=0x0A => crc değeri 0x0A84
  assert.strictEqual(crc, 0x0a84);
  const frame = modbus.appendCrc(body);
  assert.strictEqual(frame[frame.length - 2], 0x84); // lo
  assert.strictEqual(frame[frame.length - 1], 0x0a); // hi
});

test('CRC16-MODBUS bilinen vektör: 01 04 00 00 00 02 -> 71 CB', () => {
  const body = Buffer.from([0x01, 0x04, 0x00, 0x00, 0x00, 0x02]);
  const crc = modbus.crc16(body);
  assert.strictEqual(crc, 0xcb71);
  const frame = modbus.appendCrc(body);
  assert.strictEqual(frame[frame.length - 2], 0x71);
  assert.strictEqual(frame[frame.length - 1], 0xcb);
});

test('checkCrc doğru çerçeveyi kabul, bozuk çerçeveyi reddeder', () => {
  const frame = modbus.appendCrc(Buffer.from([0x01, 0x03, 0x02, 0x00, 0x1e]));
  assert.strictEqual(modbus.checkCrc(frame), true);
  const bad = Buffer.from(frame);
  bad[bad.length - 1] ^= 0xff;
  assert.strictEqual(modbus.checkCrc(bad), false);
});

test('buildReadRequest doğru çerçeve üretir', () => {
  const req = modbus.buildReadRequest(1, 3, 0x0000, 1);
  assert.deepStrictEqual(
    [...req],
    [0x01, 0x03, 0x00, 0x00, 0x00, 0x01, 0x84, 0x0a]
  );
});
