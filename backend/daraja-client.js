const { URL } = require('node:url');

const sandboxBaseUrl = 'https://sandbox.safaricom.co.ke';
const requestTimeoutMs = 10000;

function getSandboxConfig(env = process.env) {
  if ((env.MPESA_ENVIRONMENT || 'sandbox').toLowerCase() !== 'sandbox') {
    throw new Error('Live Daraja payments are disabled until the documented launch gates are approved.');
  }

  const required = [
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_SHORTCODE',
    'MPESA_PASSKEY',
    'MPESA_CALLBACK_URL',
  ];
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length) throw new Error(`Missing Daraja sandbox configuration: ${missing.join(', ')}.`);
  if (!/^\d{5,7}$/.test(env.MPESA_SHORTCODE)) throw new Error('MPESA_SHORTCODE must contain 5 to 7 digits.');
  if (!['CustomerPayBillOnline', 'CustomerBuyGoodsOnline'].includes(env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline')) {
    throw new Error('MPESA_TRANSACTION_TYPE must be CustomerPayBillOnline or CustomerBuyGoodsOnline.');
  }

  let callbackUrl;
  try {
    callbackUrl = new URL(env.MPESA_CALLBACK_URL);
  } catch {
    throw new Error('MPESA_CALLBACK_URL must be a valid HTTPS URL.');
  }
  if (callbackUrl.protocol !== 'https:') throw new Error('MPESA_CALLBACK_URL must use HTTPS.');

  return {
    consumerKey: env.MPESA_CONSUMER_KEY,
    consumerSecret: env.MPESA_CONSUMER_SECRET,
    shortcode: env.MPESA_SHORTCODE,
    passkey: env.MPESA_PASSKEY,
    callbackUrl: callbackUrl.toString(),
    transactionType: env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline',
  };
}

function mpesaTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${fields.year}${fields.month}${fields.day}${fields.hour}${fields.minute}${fields.second}`;
}

function createDarajaClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  let accessToken;
  let tokenExpiresAt = 0;

  async function requestJson(path, options) {
    const response = await fetchImpl(`${sandboxBaseUrl}${path}`, {
      ...options,
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('Daraja returned an invalid response.');
    }
    if (!response.ok) throw new Error('Daraja rejected the request.');
    return payload;
  }

  async function getAccessToken(config) {
    if (accessToken && Date.now() < tokenExpiresAt - 30000) return accessToken;
    const authorization = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
    const payload = await requestJson('/oauth/v1/generate?grant_type=client_credentials', {
      headers: { Authorization: `Basic ${authorization}` },
    });
    if (typeof payload.access_token !== 'string' || !payload.access_token) {
      throw new Error('Daraja did not return an access token.');
    }
    accessToken = payload.access_token;
    tokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000;
    return accessToken;
  }

  async function post(path, body) {
    const config = getSandboxConfig(env);
    const token = await getAccessToken(config);
    return requestJson(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  return {
    initiateStkPush({ amountKes, phoneNumber, accountReference, description }) {
      const config = getSandboxConfig(env);
      const timestamp = mpesaTimestamp();
      const password = Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString('base64');
      return post('/mpesa/stkpush/v1/processrequest', {
        BusinessShortCode: config.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: config.transactionType,
        Amount: amountKes,
        PartyA: phoneNumber,
        PartyB: config.shortcode,
        PhoneNumber: phoneNumber,
        CallBackURL: config.callbackUrl,
        AccountReference: accountReference,
        TransactionDesc: description,
      });
    },
    queryStkPush(checkoutRequestId) {
      const config = getSandboxConfig(env);
      const timestamp = mpesaTimestamp();
      const password = Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString('base64');
      return post('/mpesa/stkpushquery/v1/query', {
        BusinessShortCode: config.shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      });
    },
  };
}

module.exports = { createDarajaClient, getSandboxConfig, mpesaTimestamp };
