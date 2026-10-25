const test = require('node:test');
const assert = require('node:assert/strict');
const { toDateOnly, toDateTime, toNumber } = require('./serializers');

test('toDateOnly keeps date values date-only', () => {
  assert.equal(toDateOnly('2026-10-01'), '2026-10-01');
  assert.equal(toDateOnly(new Date('2026-10-01T00:00:00.000Z')), '2026-10-01');
  assert.equal(toDateOnly('2026-10-01T18:30:00.000Z'), '2026-10-01');
});

test('toDateTime preserves full timestamps', () => {
  assert.equal(toDateTime('2026-10-01T00:00:00.000Z'), '2026-10-01T00:00:00.000Z');
  assert.equal(toDateTime(new Date('2026-10-01T00:00:00.000Z')), '2026-10-01T00:00:00.000Z');
});

test('toNumber coerces decimal-like strings consistently', () => {
  assert.equal(toNumber('1000.00'), 1000);
  assert.equal(toNumber('0'), 0);
  assert.equal(toNumber(null), 0);
});
