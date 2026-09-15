'use strict';

const test = require('node:test');
const assert = require('node:assert');
const modbus = require('../src/modbus');

// float32 round-trip (BE: üst word ilk)
test('decodeFloat32 BE (highWordFirst) round-trip', () => {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(23.5, 0);
  const hi = buf.readUInt16BE(0);
  const lo = buf.readUInt16BE(2);
  const v = modbus.decodeFloat32([hi, lo], 0, true);
  assert.ok(Math.abs(v - 23.5) < 1e-4);
});

test('decodeFloat32 LE (lowWordFirst) round-trip', () => {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(42.25, 0);
  const hi = buf.readUInt16BE(0);
  const lo = buf.readUInt16BE(2);
  // LE image: düşük word ilk
  const v = modbus.decodeFloat32([lo, hi], 0, false);
  assert.ok(Math.abs(v - 42.25) < 1e-4);
});

test('decodeString ASCII, null kırpılır', () => {
  // "METHANOL" 8 bayt = 4 register
  const s = 'METHANOL';
  const regs = [];
  const b = Buffer.from(s, 'ascii');
  for (let i = 0; i < 4; i++) regs.push(b.readUInt16BE(i * 2));
  assert.strictEqual(modbus.decodeString(regs, 0, 8), 'METHANOL');
});

test('decodeInt16 negatif', () => {
  assert.strictEqual(modbus.decodeInt16([0xffff], 0), -1);
  assert.strictEqual(modbus.decodeInt16([0x0005], 0), 5);
});
