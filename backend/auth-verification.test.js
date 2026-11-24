const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const express = require('express');

const user = {
  id: 7,
  fullName: 'Test Member',
  email: 'member@example.test',
  passwordHash: 'hashed:LongTestPassword123!',
  emailVerifiedAt: null,
};
const sentEmails = [];
const tokens = new Map();
const sessions = [];
let failEmailDelivery = false;
const pool = {
  async query() {
    throw new Error('Unexpected pool query.');
  },
  async connect() {
    return {
      async query(sql, values = []) {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalizedSql)) return { rows: [] };
        if (normalizedSql.startsWith('INSERT INTO users')) {
          return {
            rows: [{
              id: user.id,
              fullName: values[0],
              email: values[1],
            }],
          };
        }
        if (normalizedSql.startsWith('INSERT INTO email_verification_tokens')) {
          tokens.set(values[0], { userId: values[1], expiresAt: values[2], usedAt: null });
          return { rows: [] };
        }
        if (normalizedSql.startsWith('SELECT t.user_id AS')) {
          const record = tokens.get(values[0]);
          if (!record || record.expiresAt <= new Date()) return { rows: [] };
          return {
            rows: [{
              userId: record.userId,
              usedAt: record.usedAt,
              emailVerifiedAt: user.emailVerifiedAt,
            }],
          };
        }
        if (normalizedSql.startsWith('UPDATE users SET email_verified_at')) {
          user.emailVerifiedAt = new Date();
          return { rows: [] };
        }
        if (normalizedSql.startsWith('UPDATE email_verification_tokens SET used_at')) {
          const record = tokens.get(values[0]);
          if (record) record.usedAt = new Date();
          return { rows: [] };
        }
        if (normalizedSql.startsWith('SELECT id, full_name AS "fullName", email, password_hash')) {
          return {
            rows: [{
              id: user.id,
              fullName: user.fullName,
              email: user.email,
              passwordHash: user.passwordHash,
              emailVerifiedAt: user.emailVerifiedAt,
            }],
          };
        }
        if (normalizedSql.startsWith('INSERT INTO sessions')) {
          sessions.push({ id: values[0], userId: values[1] });
          return { rows: [] };
        }
        throw new Error(`Unexpected client query: ${normalizedSql}`);
      },
      release() {},
    };
  },
};

const poolPath = require.resolve('./pool');
const emailServicePath = require.resolve('./email-service');
const bcryptPath = require.resolve('bcryptjs');
const jwtPath = require.resolve('jsonwebtoken');
require.cache[poolPath] = {
  id: poolPath,
  filename: poolPath,
  loaded: true,
  exports: { pool },
};
require.cache[emailServicePath] = {
  id: emailServicePath,
  filename: emailServicePath,
  loaded: true,
  exports: {
    getEmailConfiguration() {
      return { delivery: 'resend' };
    },
    async sendVerificationEmail(email) {
      if (failEmailDelivery) throw new Error('test delivery failure');
      sentEmails.push(email);
    },
  },
};
require.cache[bcryptPath] = {
  id: bcryptPath,
  filename: bcryptPath,
  loaded: true,
  exports: {
    hashSync: () => 'dummy-hash',
    async hash(password) {
      return `hashed:${password}`;
    },
    async compare(password, hash) {
      return `hashed:${password}` === hash;
    },
  },
};
require.cache[jwtPath] = {
  id: jwtPath,
  filename: jwtPath,
  loaded: true,
  exports: { sign: () => 'test-session-token' },
};

const authRoutes = require('./auth-routes');

test('new accounts cannot sign in until a one-time email token is verified', async () => {
  failEmailDelivery = false;
  sentEmails.length = 0;
  tokens.clear();
  sessions.length = 0;
  user.emailVerifiedAt = null;
  const app = express();
  app.use(express.json(), authRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  async function post(path, body) {
    return fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  try {
    const registration = await post('/register', {
      fullName: user.fullName,
      email: user.email,
      password: 'LongTestPassword123!',
    });
    const registrationPayload = await registration.json();
    assert.equal(registration.status, 202);
    assert.equal(registrationPayload.verificationRequired, true);
    assert.equal('token' in registrationPayload, false);
    assert.equal(sentEmails.length, 1);
    assert.equal(sessions.length, 0);

    const loginBeforeVerification = await post('/login', {
      email: user.email,
      password: 'LongTestPassword123!',
    });
    const loginError = await loginBeforeVerification.json();
    assert.equal(loginBeforeVerification.status, 403);
    assert.equal(loginError.verificationRequired, true);
    assert.equal(sessions.length, 0);

    const rawToken = sentEmails[0].token;
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    assert.equal(tokens.has(tokenHash), true);
    const verification = await post('/verification/confirm', { token: rawToken });
    assert.equal(verification.status, 200);
    assert.ok(user.emailVerifiedAt);

    const login = await post('/login', {
      email: user.email,
      password: 'LongTestPassword123!',
    });
    const loginPayload = await login.json();
    assert.equal(login.status, 200);
    assert.equal(loginPayload.token, 'test-session-token');
    assert.equal(sessions.length, 1);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('registration reports that verification is still required if email delivery fails', async () => {
  sentEmails.length = 0;
  tokens.clear();
  sessions.length = 0;
  user.emailVerifiedAt = null;
  failEmailDelivery = true;
  const app = express();
  app.use(express.json(), authRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: user.fullName,
        email: user.email,
        password: 'LongTestPassword123!',
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(payload.verificationRequired, true);
    assert.match(payload.error, /Request another email/);
    assert.equal(sessions.length, 0);
  } finally {
    failEmailDelivery = false;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
