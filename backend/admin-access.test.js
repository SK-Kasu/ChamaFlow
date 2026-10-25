const test = require('node:test');
const assert = require('node:assert/strict');
const { isPlatformAdmin } = require('./admin-access');

test('platform administrator allowlist matches normalized email addresses', () => {
  const original = process.env.PLATFORM_ADMIN_EMAILS;
  process.env.PLATFORM_ADMIN_EMAILS = ' platform@example.com,owner@example.org ';

  try {
    assert.equal(isPlatformAdmin('PLATFORM@example.com'), true);
    assert.equal(isPlatformAdmin('owner@example.org'), true);
    assert.equal(isPlatformAdmin('platform@example.com.attacker.invalid'), false);
    assert.equal(isPlatformAdmin(null), false);
  } finally {
    if (original === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = original;
  }
});

test('an empty platform administrator allowlist grants no platform access', () => {
  const original = process.env.PLATFORM_ADMIN_EMAILS;
  delete process.env.PLATFORM_ADMIN_EMAILS;

  try {
    assert.equal(isPlatformAdmin('admin@example.com'), false);
  } finally {
    if (original !== undefined) process.env.PLATFORM_ADMIN_EMAILS = original;
  }
});
