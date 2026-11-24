const test = require('node:test');
const assert = require('node:assert/strict');
const { getEmailConfiguration, sendVerificationEmail } = require('./email-service');

const configNames = ['RESEND_API_KEY', 'EMAIL_FROM', 'APP_BASE_URL'];

test('email configuration requires the Resend key, sender, and app URL', () => {
  const original = Object.fromEntries(configNames.map((name) => [name, process.env[name]]));
  const originalNodeEnv = process.env.NODE_ENV;
  for (const name of configNames) delete process.env[name];
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => getEmailConfiguration(), /RESEND_API_KEY, EMAIL_FROM, and APP_BASE_URL/);
  } finally {
    for (const name of configNames) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test('local development can deliver verification links through the backend console', async () => {
  const original = Object.fromEntries(configNames.map((name) => [name, process.env[name]]));
  const originalNodeEnv = process.env.NODE_ENV;
  const originalInfo = console.info;
  for (const name of configNames) delete process.env[name];
  process.env.NODE_ENV = 'development';
  let loggedMessage = '';
  console.info = (message) => { loggedMessage = message; };

  try {
    assert.equal(getEmailConfiguration().delivery, 'console');
    await sendVerificationEmail({
      email: 'member@example.test',
      fullName: 'Member',
      token: 'c'.repeat(64),
    });
    assert.match(loggedMessage, /http:\/\/localhost:5173\/#verify=c{64}/);
  } finally {
    console.info = originalInfo;
    for (const name of configNames) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test('partial Resend configuration is not silently treated as local delivery', () => {
  const original = Object.fromEntries(configNames.map((name) => [name, process.env[name]]));
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  process.env.RESEND_API_KEY = 'test-api-key';
  delete process.env.EMAIL_FROM;
  process.env.APP_BASE_URL = 'http://localhost:5173';
  try {
    assert.throws(() => getEmailConfiguration(), /Set RESEND_API_KEY, EMAIL_FROM, and APP_BASE_URL/);
  } finally {
    for (const name of configNames) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test('console verification refuses to expose links for a non-local app URL', () => {
  const original = Object.fromEntries(configNames.map((name) => [name, process.env[name]]));
  const originalNodeEnv = process.env.NODE_ENV;
  for (const name of configNames) delete process.env[name];
  process.env.NODE_ENV = 'development';
  process.env.APP_BASE_URL = 'https://app.example.test';
  try {
    assert.throws(() => getEmailConfiguration(), /Configure Resend before using a non-local APP_BASE_URL/);
  } finally {
    for (const name of configNames) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test('Resend delivery uses a fragment verification link and escapes the recipient name', async () => {
  const original = Object.fromEntries(configNames.map((name) => [name, process.env[name]]));
  const originalFetch = global.fetch;
  Object.assign(process.env, {
    RESEND_API_KEY: 'test-api-key',
    EMAIL_FROM: 'ChamaFlow <test@example.com>',
    APP_BASE_URL: 'https://app.example.test/',
  });
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  let requestUrl;
  let requestOptions;
  global.fetch = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return { ok: true, status: 200 };
  };

  try {
    await sendVerificationEmail({
      email: 'member@example.test',
      fullName: '<member & friend>',
      token: 'a'.repeat(64),
    });
    const body = JSON.parse(requestOptions.body);
    assert.equal(requestUrl, 'https://api.resend.com/emails');
    assert.equal(requestOptions.headers.Authorization, 'Bearer test-api-key');
    assert.equal(body.to[0], 'member@example.test');
    assert.match(body.html, /&lt;member &amp; friend&gt;/);
    assert.match(body.html, /#verify=a{64}/);
    assert.doesNotMatch(body.html, /href="https:\/\/app\.example\.test\/\?verify=/);
  } finally {
    global.fetch = originalFetch;
    for (const name of configNames) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test('Resend errors are surfaced without forwarding provider response content', async () => {
  const original = Object.fromEntries(configNames.map((name) => [name, process.env[name]]));
  const originalFetch = global.fetch;
  Object.assign(process.env, {
    RESEND_API_KEY: 'test-api-key',
    EMAIL_FROM: 'ChamaFlow <test@example.com>',
    APP_BASE_URL: 'https://app.example.test/',
  });
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  global.fetch = async () => ({ ok: false, status: 422, text: async () => 'private provider detail' });

  try {
    await assert.rejects(
      sendVerificationEmail({ email: 'member@example.test', fullName: 'Member', token: 'b'.repeat(64) }),
      (error) => error.message.includes('HTTP 422') && !error.message.includes('private provider detail'),
    );
  } finally {
    global.fetch = originalFetch;
    for (const name of configNames) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});
