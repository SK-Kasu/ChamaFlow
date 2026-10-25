const test = require('node:test');
const assert = require('node:assert/strict');
const { createDarajaClient, getSandboxConfig, mpesaTimestamp } = require('./daraja-client');

const sandboxEnv = {
  MPESA_ENVIRONMENT: 'sandbox',
  MPESA_CONSUMER_KEY: 'test-consumer-key',
  MPESA_CONSUMER_SECRET: 'test-consumer-secret',
  MPESA_SHORTCODE: '174379',
  MPESA_PASSKEY: 'test-passkey',
  MPESA_CALLBACK_URL: 'https://example.test/api/payments/daraja/callback',
};

test('Daraja configuration accepts sandbox only and requires an HTTPS callback', () => {
  assert.equal(getSandboxConfig(sandboxEnv).shortcode, '174379');
  assert.throws(
    () => getSandboxConfig({ ...sandboxEnv, MPESA_ENVIRONMENT: 'live' }),
    /Live Daraja payments are disabled/,
  );
  assert.throws(
    () => getSandboxConfig({ ...sandboxEnv, MPESA_CALLBACK_URL: 'http://localhost/callback' }),
    /must use HTTPS/,
  );
  assert.throws(
    () => getSandboxConfig({ ...sandboxEnv, MPESA_PASSKEY: '' }),
    /MPESA_PASSKEY/,
  );
});

test('formats provider timestamps in the configured Kenya timezone', () => {
  assert.equal(mpesaTimestamp(new Date('2026-01-01T00:00:00.000Z')), '20260101030000');
});

test('initiates and queries STK requests through the sandbox API', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const payload = url.includes('/oauth/')
      ? { access_token: 'sandbox-token', expires_in: 3600 }
      : url.includes('processrequest')
        ? { ResponseCode: '0', CheckoutRequestID: 'checkout-1', MerchantRequestID: 'merchant-1' }
        : { ResponseCode: '0', ResultCode: '0' };
    return { ok: true, json: async () => payload };
  };
  const client = createDarajaClient({ env: sandboxEnv, fetchImpl });

  const initiated = await client.initiateStkPush({
    amountKes: 1000,
    phoneNumber: '254712345678',
    accountReference: 'CF1234567890',
    description: 'Chama contribution',
  });
  const queried = await client.queryStkPush('checkout-1');

  assert.equal(initiated.CheckoutRequestID, 'checkout-1');
  assert.equal(queried.ResultCode, '0');
  assert.equal(calls.length, 3);
  assert.match(calls[1].url, /\/mpesa\/stkpush\/v1\/processrequest$/);
  assert.match(calls[2].url, /\/mpesa\/stkpushquery\/v1\/query$/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer sandbox-token');
  assert.equal(JSON.parse(calls[1].options.body).Amount, 1000);
  assert.equal(JSON.parse(calls[2].options.body).CheckoutRequestID, 'checkout-1');
});
