const { pool } = require('./pool');

function isPlatformAdmin(email) {
  const allowedEmails = (process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return typeof email === 'string' && allowedEmails.includes(email.toLowerCase());
}

async function getSaccoIds(userId, queryable = pool) {
  const { rows } = await queryable.query(
    'SELECT sacco_id AS id FROM sacco_administrators WHERE user_id = $1 ORDER BY sacco_id',
    [userId],
  );
  return rows.map((row) => Number(row.id));
}

async function requireActiveSacco(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const groupId = req.params.groupId;
  const requestedSaccoId = req.method === 'POST' && req.path === '/' ? req.body?.saccoId : null;

  try {
    let result;
    if (typeof groupId === 'string' && /^[1-9]\d{0,9}$/.test(groupId)) {
      result = await pool.query(
        `SELECT s.status
         FROM chama_groups g
         JOIN saccos s ON s.id = g.sacco_id
         WHERE g.id = $1
           AND (
             $2::boolean
             OR EXISTS (SELECT 1 FROM members m WHERE m.group_id = g.id AND m.user_id = $3)
             OR EXISTS (SELECT 1 FROM sacco_administrators sa WHERE sa.sacco_id = s.id AND sa.user_id = $3)
           )`,
        [Number(groupId), isPlatformAdmin(req.user.email), req.user.id],
      );
    } else if (requestedSaccoId && /^[1-9]\d{0,9}$/.test(String(requestedSaccoId))) {
      result = await pool.query(
        `SELECT status FROM saccos
         WHERE id = $1
           AND ($2::boolean OR EXISTS (
             SELECT 1 FROM sacco_administrators sa
             WHERE sa.sacco_id = saccos.id AND sa.user_id = $3
           ))`,
        [Number(requestedSaccoId), isPlatformAdmin(req.user.email), req.user.id],
      );
    }

    if (result?.rows[0]?.status === 'suspended') {
      return res.status(423).json({ error: 'This SACCO is suspended. Group changes are temporarily disabled.' });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { getSaccoIds, isPlatformAdmin, requireActiveSacco };
