const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeKenyanPhoneNumber, toMinorUnits } = require('./payment-utils');

test('normalizes Kenyan mobile numbers for provider requests', () => {
  assert.equal(normalizeKenyanPhoneNumber('0712 345 678'), '254712345678');
  assert.equal(normalizeKenyanPhoneNumber('+254 112 345 678'), '254112345678');
  assert.equal(normalizeKenyanPhoneNumber('254712345678'), '254712345678');
});

test('rejects phone numbers outside supported Kenyan mobile formats', () => {
  assert.equal(normalizeKenyanPhoneNumber('071234567'), null);
  assert.equal(normalizeKenyanPhoneNumber('254212345678'), null);
  assert.equal(normalizeKenyanPhoneNumber(712345678), null);
});

test('converts decimal KES amounts to integer minor units without float rounding', () => {
  assert.equal(toMinorUnits('1000.01'), 100001);
  assert.equal(toMinorUnits('10'), 1000);
  assert.equal(toMinorUnits('0.01'), 1);
  assert.equal(toMinorUnits('0'), null);
  assert.equal(toMinorUnits('1.234'), null);
});
