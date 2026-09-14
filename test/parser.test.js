'use strict';

const test = require('node:test');
const assert = require('node:assert');
const modbus = require('../src/modbus');

// Örnek FC03 cevabı: slave 1, 1 register (0x001E = 30)
const respBody = Buffer.from([0x01, 0x03, 0x02, 0x00, 0x1e]);
const frame = modbus.appendCrc(respBody); // 7 bayt
const expectedLen = modbus.expectedReadResponseLen(1); // 3 + 2 + 2 = 7

test('kısmi paket: yeterli bayt yokken null döner', () => {
  const partial = frame.subarray(0, 4);
  assert.strictEqual(modbus.tryExtractFrame(partial, expectedLen), null);
});

test('tam çerçeve: crcOk true, rest boş', () => {
  const r = modbus.tryExtractFrame(frame, expectedLen);
  assert.ok(r);
  assert.strictEqual(r.crcOk, true);
  assert.strictEqual(r.rest.length, 0);
  const parsed = modbus.parseReadResponse(r.frame);
  assert.deepStrictEqual(parsed.registers, [0x001e]);
});

test('bitişik iki çerçeve: ilki çıkar, ikincisi rest içinde kalır', () => {
  const two = Buffer.concat([frame, frame]);
  const r = modbus.tryExtractFrame(two, expectedLen);
  assert.ok(r);
  assert.strictEqual(r.crcOk, true);
  assert.strictEqual(r.rest.length, frame.length);
  // rest'ten ikinci çerçeve de çıkarılabilmeli
  const r2 = modbus.tryExtractFrame(r.rest, expectedLen);
  assert.ok(r2);
  assert.strictEqual(r2.crcOk, true);
});

test('bozuk CRC: crcOk false', () => {
  const bad = Buffer.from(frame);
  bad[bad.length - 1] ^= 0xff;
  const r = modbus.tryExtractFrame(bad, expectedLen);
  assert.ok(r);
  assert.strictEqual(r.crcOk, false);
});

test('parçalı gelen baytlar birleşince çözülür', () => {
  let acc = Buffer.alloc(0);
  const chunks = [frame.subarray(0, 3), frame.subarray(3, 5), frame.subarray(5)];
  let result = null;
  for (const c of chunks) {
    acc = Buffer.concat([acc, c]);
    result = modbus.tryExtractFrame(acc, expectedLen);
  }
  assert.ok(result);
  assert.strictEqual(result.crcOk, true);
});

test('exception cevabı parse edilir', () => {
  const exBody = Buffer.from([0x01, 0x83, 0x02]); // fc03 exception, kod 2
  const exFrame = modbus.appendCrc(exBody);
  const parsed = modbus.parseReadResponse(exFrame);
  assert.strictEqual(parsed.exception, 2);
  assert.strictEqual(parsed.fc, 3);
});
