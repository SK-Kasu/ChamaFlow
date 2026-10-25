const jwt = require('jsonwebtoken');
const { pool } = require('./pool');

async function requireAuth(req, res, next) {
  const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'chamaflow-api',
      audience: 'chamaflow-client',
    });
    if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
      return res.status(401).json({ error: 'Your session is invalid. Sign in again.' });
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.full_name AS "fullName", u.email, s.id AS "sessionId"
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.user_id = $2
         AND s.revoked_at IS NULL AND s.expires_at > NOW()`,
      [payload.jti, Number(payload.sub)],
    );
    if (!rows[0]) return res.status(401).json({ error: 'Your session expired. Sign in again.' });
    req.user = rows[0];
    req.sessionId = rows[0].sessionId;
    return next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Your session is invalid or expired. Sign in again.' });
    }
    return next(error);
  }
}

module.exports = { requireAuth };
