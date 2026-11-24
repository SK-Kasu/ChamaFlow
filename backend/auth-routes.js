const { createHash, randomBytes, randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { pool } = require('./pool');
const { requireAuth } = require('./auth-middleware');
const { getEmailConfiguration, sendVerificationEmail } = require('./email-service');

const router = express.Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
});
const verificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many verification attempts. Try again later.' },
});
const sessionLifetimeSeconds = 12 * 60 * 60;
const verificationLifetimeMs = 24 * 60 * 60 * 1000;
const dummyPasswordHash = bcrypt.hashSync('chamaflow-invalid-password', 12);
const genericVerificationMessage = 'If an account can be created or needs verification for this email, we will send instructions shortly.';

function getVerificationMessage(delivery) {
  return delivery === 'console'
    ? 'If an account can be created or needs verification for this email, check the backend console for a local verification link.'
    : genericVerificationMessage;
}

async function createVerificationToken(client, userId) {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await client.query(
    `INSERT INTO email_verification_tokens (token_hash, user_id, expires_at)
     VALUES ($1, $2, $3)`,
    [tokenHash, userId, new Date(Date.now() + verificationLifetimeMs)],
  );
  return token;
}

function hashVerificationToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

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
  let emailDelivery;
  try {
    emailDelivery = getEmailConfiguration().delivery;
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }

  const client = await pool.connect();
  let user;
  let verificationToken;
  try {
    await client.query('BEGIN');
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await client.query(
      `INSERT INTO users (full_name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, full_name AS "fullName", email`,
      [fullName, email, passwordHash],
    );
    user = rows[0];
    verificationToken = await createVerificationToken(client, user.id);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(202).json({ verificationRequired: true, message: getVerificationMessage(emailDelivery) });
    }
    return next(error);
  } finally {
    client.release();
  }
  try {
    await sendVerificationEmail({ email: user.email, fullName: user.fullName, token: verificationToken });
  } catch (error) {
    console.error('Could not send account verification email:', error.message);
    return res.status(503).json({
      error: 'Your account was created, but the verification message could not be sent. Request another email to continue.',
      verificationRequired: true,
    });
  }
  return res.status(202).json({ verificationRequired: true, message: getVerificationMessage(emailDelivery) });
});

router.post('/verification/resend', verificationLimiter, async (req, res, next) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(202).json({ message: genericVerificationMessage });
  }
  let emailDelivery;
  try {
    emailDelivery = getEmailConfiguration().delivery;
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }

  const client = await pool.connect();
  let user;
  let verificationToken;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, full_name AS "fullName", email, email_verified_at AS "emailVerifiedAt"
       FROM users WHERE LOWER(email) = $1 FOR UPDATE`,
      [email],
    );
    user = rows[0];
    if (user && !user.emailVerifiedAt) {
      const { rows: recentTokens } = await client.query(
        `SELECT 1 FROM email_verification_tokens
         WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 minute'
         LIMIT 1`,
        [user.id],
      );
      if (!recentTokens.length) {
        await client.query(
          `UPDATE email_verification_tokens SET used_at = NOW()
           WHERE user_id = $1 AND used_at IS NULL`,
          [user.id],
        );
        verificationToken = await createVerificationToken(client, user.id);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }

  if (verificationToken) {
    try {
      await sendVerificationEmail({ email: user.email, fullName: user.fullName, token: verificationToken });
    } catch (error) {
      console.error('Could not resend account verification email:', error.message);
    }
  }
  return res.status(202).json({ message: getVerificationMessage(emailDelivery) });
});

router.post('/verification/confirm', verificationLimiter, async (req, res, next) => {
  const token = typeof req.body.token === 'string' ? req.body.token : '';
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'This verification link is invalid or expired.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT t.user_id AS "userId", t.used_at AS "usedAt",
              u.email_verified_at AS "emailVerifiedAt"
       FROM email_verification_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1 AND t.expires_at > NOW()
       FOR UPDATE OF t`,
      [hashVerificationToken(token)],
    );
    const verification = rows[0];
    if (!verification || (verification.usedAt && !verification.emailVerifiedAt)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This verification link is invalid or expired.' });
    }
    if (!verification.emailVerifiedAt) {
      await client.query('UPDATE users SET email_verified_at = NOW(), updated_at = NOW() WHERE id = $1', [verification.userId]);
      await client.query('UPDATE email_verification_tokens SET used_at = NOW() WHERE token_hash = $1', [hashVerificationToken(token)]);
    }
    await client.query('COMMIT');
    return res.json({ verified: true, message: 'Your email is verified. You can now sign in.' });
  } catch (error) {
    await client.query('ROLLBACK');
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
      `SELECT id, full_name AS "fullName", email, password_hash AS "passwordHash",
              email_verified_at AS "emailVerifiedAt"
       FROM users WHERE LOWER(email) = $1`,
      [email],
    );
    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user?.passwordHash || dummyPasswordHash);
    if (!user || !validPassword) return res.status(401).json({ error: 'Email or password is incorrect.' });
    if (!user.emailVerifiedAt) {
      return res.status(403).json({
        error: 'Verify your email address before signing in. You can request another verification message.',
        verificationRequired: true,
      });
    }

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

router.patch('/me', requireAuth, async (req, res, next) => {
  const fullName = typeof req.body.fullName === 'string' ? req.body.fullName.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (fullName.length < 2 || fullName.length > 100) {
    return res.status(400).json({ error: 'Name must be between 2 and 100 characters.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (email !== req.user.email.toLowerCase()) {
    let emailDelivery;
    try {
      emailDelivery = getEmailConfiguration().delivery;
    } catch (error) {
      return res.status(503).json({ error: error.message });
    }

    const client = await pool.connect();
    let updatedUser;
    let verificationToken;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE users SET full_name = $2, email = $3, email_verified_at = NULL, updated_at = NOW()
         WHERE id = $1
         RETURNING id, full_name AS "fullName", email`,
        [req.user.id, fullName, email],
      );
      updatedUser = rows[0];
      await client.query('UPDATE email_verification_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [req.user.id]);
      verificationToken = await createVerificationToken(client, req.user.id);
      await client.query('UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [req.user.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: 'An account with this email already exists.' });
      return next(error);
    } finally {
      client.release();
    }
    try {
      await sendVerificationEmail({ email: updatedUser.email, fullName: updatedUser.fullName, token: verificationToken });
    } catch (error) {
      console.error('Could not send updated-email verification:', error.message);
      return res.status(503).json({
        error: 'Your email was changed, but the verification message could not be sent. Request another email to continue.',
        verificationRequired: true,
      });
    }
    return res.json({
      user: updatedUser,
      verificationRequired: true,
      message: emailDelivery === 'console'
        ? 'Your email was changed. Open the verification link in the backend console before signing in again.'
        : 'Your email was changed. Verify the new address before signing in again.',
    });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE users SET full_name = $2, email = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING id, full_name AS "fullName", email`,
      [req.user.id, fullName, email],
    );
    res.json({ user: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An account with this email already exists.' });
    next(error);
  }
});

router.patch('/password', requireAuth, async (req, res, next) => {
  const currentPassword = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
  if (currentPassword.length > 128 || newPassword.length < 12 || newPassword.length > 128) {
    return res.status(400).json({ error: 'Enter your current password and a new password of 12 to 128 characters.' });
  }

  try {
    const { rows } = await pool.query('SELECT password_hash AS "passwordHash" FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0] || !await bcrypt.compare(currentPassword, rows[0].passwordHash)) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      `UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
      [req.user.id, passwordHash],
    );
    await pool.query(
      'UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL',
      [req.user.id, req.sessionId],
    );
    res.json({ message: 'Password updated. Other active sessions have been signed out.' });
  } catch (error) {
    next(error);
  }
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
