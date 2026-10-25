const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { pool } = require('./pool');
const { requireAuth } = require('./auth-middleware');

const router = express.Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
});
const sessionLifetimeSeconds = 12 * 60 * 60;
const dummyPasswordHash = bcrypt.hashSync('chamaflow-invalid-password', 12);

function createAccessToken(user, sessionId) {
  return jwt.sign(
    {},
    process.env.JWT_SECRET,
    {
      subject: String(user.id),
      jwtid: sessionId,
      issuer: 'chamaflow-api',
      audience: 'chamaflow-client',
      expiresIn: sessionLifetimeSeconds,
    },
  );
}

async function startSession(client, user) {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + sessionLifetimeSeconds * 1000);
  await client.query(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)',
    [sessionId, user.id, expiresAt],
  );
  return {
    token: createAccessToken(user, sessionId),
    expiresAt: expiresAt.toISOString(),
  };
}

router.post('/register', authLimiter, async (req, res, next) => {
  const fullName = typeof req.body.fullName === 'string' ? req.body.fullName.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (fullName.length < 2 || fullName.length > 100) {
    return res.status(400).json({ error: 'Name must be between 2 and 100 characters.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (password.length < 12 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be between 12 and 128 characters.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await client.query(
      `INSERT INTO users (full_name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, full_name AS "fullName", email`,
      [fullName, email, passwordHash],
    );
    const user = rows[0];
    const session = await startSession(client, user);
    await client.query('COMMIT');
    res.status(201).json({ user, ...session });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'An account with this email already exists.' });
    return next(error);
  } finally {
    client.release();
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (email.length > 254 || password.length > 128) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      'SELECT id, full_name AS "fullName", email, password_hash AS "passwordHash" FROM users WHERE LOWER(email) = $1',
      [email],
    );
    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user?.passwordHash || dummyPasswordHash);
    if (!user || !validPassword) return res.status(401).json({ error: 'Email or password is incorrect.' });

    await client.query('BEGIN');
    const session = await startSession(client, user);
    await client.query('COMMIT');
    delete user.passwordHash;
    res.json({ user, ...session });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, fullName: req.user.fullName, email: req.user.email } });
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await pool.query('UPDATE sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL', [req.sessionId]);
    res.json({ message: 'Signed out.' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
