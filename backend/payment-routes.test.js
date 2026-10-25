const test = require('node:test');
const assert = require('node:assert/strict');
const { isProviderFailure, isProviderSuccess } = require('./payment-routes');

test('only a successful provider status query confirms a payment', () => {
  assert.equal(isProviderSuccess({ ResponseCode: '0', ResultCode: '0' }), true);
  assert.equal(isProviderSuccess({ ResponseCode: '0', ResultCode: '1032' }), false);
  assert.equal(isProviderSuccess({ ResponseCode: '1', ResultCode: '0' }), false);
  assert.equal(isProviderSuccess({ ResponseCode: '0' }), false);
});

test('only final provider failures become failed payment states', () => {
  assert.equal(isProviderFailure({ ResponseCode: '0', ResultCode: '1032' }), true);
  assert.equal(isProviderFailure({ ResponseCode: '0', ResultCode: '0' }), false);
  assert.equal(isProviderFailure({ ResponseCode: '1', ResultCode: '1032' }), false);
  assert.equal(isProviderFailure({ ResponseCode: '0' }), false);
});
