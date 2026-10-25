const express = require('express');
const { pool } = require('./pool');
const { requireAuth } = require('./auth-middleware');
const { isPlatformAdmin } = require('./admin-access');

const router = express.Router();

function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function getAdminScope(req) {
  return {
    platformAdmin: isPlatformAdmin(req.user.email),
    userId: req.user.id,
  };
}

async function recordAudit(client, actorId, saccoId, action, targetType, targetId, details = {}) {
  await client.query(
    `INSERT INTO administration_audit
       (actor_id, sacco_id, action, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [actorId, saccoId, action, targetType, targetId === null ? null : String(targetId), JSON.stringify(details)],
  );
}

async function canManageSacco(req, saccoId, queryable = pool) {
  if (isPlatformAdmin(req.user.email)) return true;
  const { rows } = await queryable.query(
    'SELECT 1 FROM sacco_administrators WHERE sacco_id = $1 AND user_id = $2',
    [saccoId, req.user.id],
  );
  return rows.length > 0;
}

router.use(requireAuth);

router.get('/access', async (req, res, next) => {
  try {
    const platformAdmin = isPlatformAdmin(req.user.email);
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.status
       FROM saccos s
       WHERE $1::boolean OR EXISTS (
         SELECT 1 FROM sacco_administrators sa
         WHERE sa.sacco_id = s.id AND sa.user_id = $2
       )
       ORDER BY s.name`,
      [platformAdmin, req.user.id],
    );
    res.json({
      platformAdmin,
      saccoAdmin: rows.length > 0,
      saccos: rows.map((sacco) => ({ ...sacco, id: Number(sacco.id) })),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/overview', async (req, res, next) => {
  const { platformAdmin, userId } = getAdminScope(req);
  try {
    const { rows } = await pool.query(
      `WITH authorized_groups AS (
         SELECT g.id, g.sacco_id, g.cycle_number
         FROM chama_groups g
         WHERE $1::boolean OR EXISTS (
           SELECT 1 FROM sacco_administrators sa
           WHERE sa.sacco_id = g.sacco_id AND sa.user_id = $2
         )
       )
       SELECT
         (SELECT COUNT(*)::INTEGER FROM saccos s
          WHERE $1::boolean OR EXISTS (
            SELECT 1 FROM sacco_administrators sa
            WHERE sa.sacco_id = s.id AND sa.user_id = $2
          )) AS "saccoCount",
         COUNT(DISTINCT g.id)::INTEGER AS "groupCount",
         COUNT(DISTINCT m.id)::INTEGER AS "memberCount",
         COUNT(DISTINCT c.id) FILTER (WHERE c.status IN ('pending', 'late'))::INTEGER AS "openContributionCount",
         COUNT(DISTINCT g.id) FILTER (WHERE s.status = 'suspended')::INTEGER AS "suspendedGroupCount"
       FROM authorized_groups g
       LEFT JOIN saccos s ON s.id = g.sacco_id
       LEFT JOIN members m ON m.group_id = g.id
       LEFT JOIN contributions c ON c.group_id = g.id AND c.period_number = g.cycle_number`,
      [platformAdmin, userId],
    );
    res.json({
      ...rows[0],
      saccoCount: Number(rows[0].saccoCount),
      groupCount: Number(rows[0].groupCount),
      memberCount: Number(rows[0].memberCount),
      openContributionCount: Number(rows[0].openContributionCount),
      suspendedGroupCount: Number(rows[0].suspendedGroupCount),
      platformAdmin,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/saccos', async (req, res, next) => {
  const { platformAdmin, userId } = getAdminScope(req);
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.status, s.created_at AS "createdAt",
              COUNT(DISTINCT g.id)::INTEGER AS "groupCount",
              COUNT(DISTINCT m.id)::INTEGER AS "memberCount",
              COUNT(DISTINCT sa.user_id)::INTEGER AS "administratorCount",
              COALESCE(
                JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(
                  'id', u.id, 'fullName', u.full_name, 'email', u.email
                )) FILTER (WHERE u.id IS NOT NULL),
                '[]'::json
              ) AS administrators
       FROM saccos s
       LEFT JOIN chama_groups g ON g.sacco_id = s.id
       LEFT JOIN members m ON m.group_id = g.id
       LEFT JOIN sacco_administrators sa ON sa.sacco_id = s.id
       LEFT JOIN users u ON u.id = sa.user_id
       WHERE $1::boolean OR EXISTS (
         SELECT 1 FROM sacco_administrators own
         WHERE own.sacco_id = s.id AND own.user_id = $2
       )
       GROUP BY s.id
       ORDER BY s.name
       LIMIT 200`,
      [platformAdmin, userId],
    );
    res.json({
      saccos: rows.map((row) => ({
        ...row,
        id: Number(row.id),
        groupCount: Number(row.groupCount),
        memberCount: Number(row.memberCount),
        administratorCount: Number(row.administratorCount),
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/saccos', async (req, res, next) => {
  if (!isPlatformAdmin(req.user.email)) return res.status(403).json({ error: 'Platform administrator access is required.' });
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const adminEmail = typeof req.body.adminEmail === 'string' ? req.body.adminEmail.trim().toLowerCase() : '';
  if (name.length < 2 || name.length > 120) return res.status(400).json({ error: 'SACCO name must be between 2 and 120 characters.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) || adminEmail.length > 254) {
    return res.status(400).json({ error: 'Enter the email address of an existing administrator account.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: users } = await client.query(
      'SELECT id FROM users WHERE LOWER(email) = $1',
      [adminEmail],
    );
    if (!users[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No ChamaFlow account exists with that email yet.' });
    }
    const { rows } = await client.query(
      `INSERT INTO saccos (name, created_by)
       VALUES ($1, $2)
       RETURNING id, name, status, created_at AS "createdAt"`,
      [name, req.user.id],
    );
    const sacco = rows[0];
    await client.query(
      'INSERT INTO sacco_administrators (sacco_id, user_id, assigned_by) VALUES ($1, $2, $3)',
      [sacco.id, users[0].id, req.user.id],
    );
    await recordAudit(client, req.user.id, sacco.id, 'sacco.created', 'sacco', sacco.id, { name, firstAdminEmail: adminEmail });
    await client.query('COMMIT');
    res.status(201).json({ sacco: { ...sacco, id: Number(sacco.id), administratorCount: 1, groupCount: 0, memberCount: 0 } });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'A SACCO with that name already exists.' });
    next(error);
  } finally {
    client.release();
  }
});

router.patch('/saccos/:saccoId', async (req, res, next) => {
  if (!isPlatformAdmin(req.user.email)) return res.status(403).json({ error: 'Platform administrator access is required.' });
  const saccoId = parseId(req.params.saccoId);
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : undefined;
  const status = req.body.status;
  if (!saccoId) return res.status(400).json({ error: 'SACCO ID must be a positive integer.' });
  if (name !== undefined && (name.length < 2 || name.length > 120)) return res.status(400).json({ error: 'SACCO name must be between 2 and 120 characters.' });
  if (status !== undefined && !['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'SACCO status must be active or suspended.' });
  if (name === undefined && status === undefined) return res.status(400).json({ error: 'Provide a SACCO name or status to update.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE saccos
       SET name = COALESCE($2, name),
           status = COALESCE($3, status),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, status`,
      [saccoId, name ?? null, status ?? null],
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'SACCO not found.' });
    }
    await recordAudit(client, req.user.id, saccoId, 'sacco.updated', 'sacco', saccoId, { name: rows[0].name, status: rows[0].status });
    await client.query('COMMIT');
    res.json({ sacco: { ...rows[0], id: Number(rows[0].id) } });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'A SACCO with that name already exists.' });
    next(error);
  } finally {
    client.release();
  }
});

router.post('/saccos/:saccoId/administrators', async (req, res, next) => {
  if (!isPlatformAdmin(req.user.email)) return res.status(403).json({ error: 'Platform administrator access is required.' });
  const saccoId = parseId(req.params.saccoId);
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!saccoId) return res.status(400).json({ error: 'SACCO ID must be a positive integer.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Enter the email address of an existing administrator account.' });
  }
  try {
    const { rows: users } = await pool.query(
      'SELECT id, full_name AS "fullName", email FROM users WHERE LOWER(email) = $1',
      [email],
    );
    if (!users[0]) return res.status(404).json({ error: 'No ChamaFlow account exists with that email yet.' });
    const { rows: saccos } = await pool.query('SELECT id FROM saccos WHERE id = $1', [saccoId]);
    if (!saccos[0]) return res.status(404).json({ error: 'SACCO not found.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO sacco_administrators (sacco_id, user_id, assigned_by) VALUES ($1, $2, $3)',
        [saccoId, users[0].id, req.user.id],
      );
      await recordAudit(client, req.user.id, saccoId, 'sacco.admin_assigned', 'user', users[0].id, { email: users[0].email });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    res.status(201).json({ administrator: users[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That user is already an administrator of this SACCO.' });
    next(error);
  }
});

router.delete('/saccos/:saccoId/administrators/:userId', async (req, res, next) => {
  if (!isPlatformAdmin(req.user.email)) return res.status(403).json({ error: 'Platform administrator access is required.' });
  const saccoId = parseId(req.params.saccoId);
  const userId = parseId(req.params.userId);
  if (!saccoId || !userId) return res.status(400).json({ error: 'SACCO and user IDs must be positive integers.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: saccos } = await client.query(
      'SELECT status FROM saccos WHERE id = $1 FOR UPDATE',
      [saccoId],
    );
    if (!saccos[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'SACCO not found.' });
    }
    const { rows: countRows } = await client.query(
      'SELECT COUNT(*)::INTEGER AS count FROM sacco_administrators WHERE sacco_id = $1',
      [saccoId],
    );
    if (Number(countRows[0].count) <= 1) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A SACCO must retain at least one administrator.' });
    }
    const { rows } = await client.query(
      `DELETE FROM sacco_administrators
       WHERE sacco_id = $1 AND user_id = $2
       RETURNING user_id`,
      [saccoId, userId],
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'SACCO administrator not found.' });
    }
    await recordAudit(client, req.user.id, saccoId, 'sacco.admin_removed', 'user', userId);
    await client.query('COMMIT');
    res.json({ removed: true });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

router.get('/groups', async (req, res, next) => {
  const { platformAdmin, userId } = getAdminScope(req);
  try {
    const { rows } = await pool.query(
      `SELECT g.id, g.sacco_id AS "saccoId", s.name AS "saccoName",
              s.status AS "saccoStatus",
              g.name, g.contribution_amount AS "contributionAmount",
              g.cycle_number AS "cycleNumber", g.frequency, g.status,
              COUNT(DISTINCT m.id)::INTEGER AS "memberCount",
              COUNT(DISTINCT c.id) FILTER (WHERE c.status IN ('pending', 'late'))::INTEGER AS "openContributionCount"
       FROM chama_groups g
       LEFT JOIN saccos s ON s.id = g.sacco_id
       LEFT JOIN members m ON m.group_id = g.id
       LEFT JOIN contributions c ON c.group_id = g.id AND c.period_number = g.cycle_number
       WHERE $1::boolean OR EXISTS (
         SELECT 1 FROM sacco_administrators sa
         WHERE sa.sacco_id = g.sacco_id AND sa.user_id = $2
       )
       GROUP BY g.id, s.name, s.status
       ORDER BY s.name NULLS LAST, g.name
       LIMIT 500`,
      [platformAdmin, userId],
    );
    res.json({
      groups: rows.map((row) => ({
        ...row,
        id: Number(row.id),
        saccoId: row.saccoId === null ? null : Number(row.saccoId),
        contributionAmount: Number(row.contributionAmount),
        cycleNumber: Number(row.cycleNumber),
        memberCount: Number(row.memberCount),
        openContributionCount: Number(row.openContributionCount),
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/groups/:groupId', async (req, res, next) => {
  const groupId = parseId(req.params.groupId);
  if (!groupId) return res.status(400).json({ error: 'Group ID must be a positive integer.' });
  try {
    const { rows: groupRows } = await pool.query(
      `SELECT g.id, g.sacco_id AS "saccoId", s.name AS "saccoName",
              s.status AS "saccoStatus", g.name, g.contribution_amount AS "contributionAmount",
              g.cycle_number AS "cycleNumber", g.frequency, g.status,
              TO_CHAR(g.start_date, 'YYYY-MM-DD') AS "startDate"
       FROM chama_groups g
       LEFT JOIN saccos s ON s.id = g.sacco_id
       WHERE g.id = $1
         AND ($2::boolean OR EXISTS (
           SELECT 1 FROM sacco_administrators sa
           WHERE sa.sacco_id = g.sacco_id AND sa.user_id = $3
         ))`,
      [groupId, isPlatformAdmin(req.user.email), req.user.id],
    );
    const group = groupRows[0];
    if (!group) return res.status(404).json({ error: 'Savings group not found.' });
    const [membersResult, contributionsResult, slotsResult] = await Promise.all([
      pool.query(
        `SELECT m.id, m.name, m.role, u.email
         FROM members m
         LEFT JOIN users u ON u.id = m.user_id
         WHERE m.group_id = $1
         ORDER BY m.id`,
        [groupId],
      ),
      pool.query(
        `SELECT c.id, c.member_id AS "memberId", m.name AS "memberName",
                c.period_number AS "periodNumber", c.amount,
                TO_CHAR(c.due_date, 'YYYY-MM-DD') AS "dueDate",
                CASE WHEN c.status = 'pending' AND c.due_date < CURRENT_DATE THEN 'late'
                     ELSE c.status END AS status,
                c.payment_method AS "paymentMethod", c.paid_at AS "paidAt"
         FROM contributions c
         JOIN members m ON m.id = c.member_id
         WHERE c.group_id = $1 AND c.period_number = $2
         ORDER BY c.due_date, m.name`,
        [groupId, group.cycleNumber],
      ),
      pool.query(
        `SELECT p.id, p.position, p.member_id AS "memberId", m.name AS "memberName",
                p.amount, TO_CHAR(p.payout_date, 'YYYY-MM-DD') AS "payoutDate",
                p.status, p.paid_at AS "paidAt"
         FROM payout_slots p
         JOIN members m ON m.id = p.member_id
         WHERE p.group_id = $1
         ORDER BY p.position`,
        [groupId],
      ),
    ]);
    res.json({
      group: {
        ...group,
        id: Number(group.id),
        saccoId: group.saccoId === null ? null : Number(group.saccoId),
        contributionAmount: Number(group.contributionAmount),
        cycleNumber: Number(group.cycleNumber),
      },
      members: membersResult.rows,
      contributions: contributionsResult.rows.map((item) => ({
        ...item,
        memberId: Number(item.memberId),
        periodNumber: Number(item.periodNumber),
        amount: Number(item.amount),
      })),
      payoutSlots: slotsResult.rows.map((item) => ({
        ...item,
        memberId: Number(item.memberId),
        position: Number(item.position),
        amount: Number(item.amount),
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/groups/:groupId/members', async (req, res, next) => {
  const groupId = parseId(req.params.groupId);
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!groupId) return res.status(400).json({ error: 'Group ID must be a positive integer.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Enter the email address of an existing ChamaFlow account.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: groupRows } = await client.query(
      `SELECT g.id, g.sacco_id AS "saccoId", s.status AS "saccoStatus",
              g.contribution_amount AS "contributionAmount", g.frequency,
              TO_CHAR(g.start_date, 'YYYY-MM-DD') AS "startDate",
              g.cycle_number AS "cycleNumber", g.status AS "groupStatus"
       FROM chama_groups g
       LEFT JOIN saccos s ON s.id = g.sacco_id
       WHERE g.id = $1
       FOR UPDATE OF g`,
      [groupId],
    );
    const group = groupRows[0];
    if (!group || (!isPlatformAdmin(req.user.email)
      && (!group.saccoId || !await canManageSacco(req, Number(group.saccoId), client)))) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Savings group not found.' });
    }
    if (!isPlatformAdmin(req.user.email) && group.saccoStatus === 'suspended') {
      await client.query('ROLLBACK');
      return res.status(423).json({ error: 'This SACCO is suspended. Group changes are temporarily disabled.' });
    }
    if (group.groupStatus !== 'active') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Members can only be added to an active group.' });
    }
    const { rows: userRows } = await client.query(
      'SELECT id, full_name AS "fullName", email FROM users WHERE LOWER(email) = $1',
      [email],
    );
    if (!userRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No ChamaFlow account exists with that email yet.' });
    }
    const target = userRows[0];
    const { rows: existing } = await client.query(
      'SELECT 1 FROM members WHERE group_id = $1 AND user_id = $2',
      [groupId, target.id],
    );
    if (existing.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'That account is already a member of this group.' });
    }
    const { rows: locked } = await client.query(
      `SELECT 1 FROM payout_slots WHERE group_id = $1 AND status = 'paid'
       UNION ALL
       SELECT 1 FROM contributions WHERE group_id = $1 AND status = 'paid'
       LIMIT 1`,
      [groupId],
    );
    if (locked.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Members can only be added before a payout or contribution is recorded.' });
    }
    const { rows: positionRows } = await client.query(
      `SELECT COALESCE(MAX(position), 0)::INTEGER AS position,
              COUNT(*)::INTEGER AS member_count
       FROM payout_slots WHERE group_id = $1`,
      [groupId],
    );
    const position = Number(positionRows[0].position) + 1;
    if (Number(positionRows[0].member_count) >= 100) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This group has reached the 100-member limit.' });
    }
    if (Number(group.contributionAmount) * position > 9999999999.99) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'The total payout is too large to add another member.' });
    }
    const { rows: memberRows } = await client.query(
      `INSERT INTO members (group_id, user_id, name, role)
       VALUES ($1, $2, $3, 'Member')
       RETURNING id, name, role`,
      [groupId, target.id, target.fullName],
    );
    const payoutAmount = Number(group.contributionAmount) * position;
    await client.query(
      `INSERT INTO payout_slots (group_id, member_id, position, payout_date, amount)
       VALUES (
         $1, $2, $3,
         ($4::date + (($3 - 1) * CASE $5
           WHEN 'weekly' THEN INTERVAL '1 week'
           WHEN 'biweekly' THEN INTERVAL '2 weeks'
           ELSE INTERVAL '1 month'
         END))::date,
         $6
       )`,
      [groupId, memberRows[0].id, position, group.startDate, group.frequency, payoutAmount],
    );
    await client.query(
      `INSERT INTO contributions (group_id, member_id, period_number, amount, due_date)
       VALUES ($1, $2, $3, $4, $5)`,
      [groupId, memberRows[0].id, group.cycleNumber, group.contributionAmount, group.startDate],
    );
    await client.query(
      `UPDATE payout_slots SET amount = $2
       WHERE group_id = $1 AND status = 'upcoming'`,
      [groupId, payoutAmount],
    );
    await client.query(
      `INSERT INTO activity (group_id, member_id, type, description, amount)
       VALUES ($1, $2, 'contribution', $3, $4)`,
      [groupId, memberRows[0].id, `${target.fullName} joined the circle`, group.contributionAmount],
    );
    await recordAudit(client, req.user.id, group.saccoId, 'group.member_added', 'member', memberRows[0].id, {
      groupId,
      email: target.email,
    });
    await client.query('COMMIT');
    res.status(201).json({
      member: { ...memberRows[0], email: target.email, trustScore: 70, paid: false },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

router.patch('/groups/:groupId', async (req, res, next) => {
  const groupId = parseId(req.params.groupId);
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : undefined;
  const status = req.body.status;
  if (!groupId) return res.status(400).json({ error: 'Group ID must be a positive integer.' });
  if (name !== undefined && (name.length < 2 || name.length > 100)) return res.status(400).json({ error: 'Group name must be between 2 and 100 characters.' });
  if (status !== undefined && !['active', 'completed', 'archived'].includes(status)) return res.status(400).json({ error: 'Group status must be active, completed, or archived.' });
  if (name === undefined && status === undefined) return res.status(400).json({ error: 'Provide a group name or status to update.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: groupRows } = await client.query(
      `SELECT g.sacco_id AS "saccoId", s.status AS "saccoStatus"
       FROM chama_groups g
       LEFT JOIN saccos s ON s.id = g.sacco_id
       WHERE g.id = $1
       FOR UPDATE OF g`,
      [groupId],
    );
    if (!groupRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Savings group not found.' });
    }
    const saccoId = groupRows[0].saccoId === null ? null : Number(groupRows[0].saccoId);
    if (!isPlatformAdmin(req.user.email) && (!saccoId || !await canManageSacco(req, saccoId, client))) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Savings group not found.' });
    }
    if (!isPlatformAdmin(req.user.email) && groupRows[0].saccoStatus === 'suspended') {
      await client.query('ROLLBACK');
      return res.status(423).json({ error: 'This SACCO is suspended. Group changes are temporarily disabled.' });
    }
    const { rows } = await client.query(
      `UPDATE chama_groups
       SET name = COALESCE($2, name),
           status = COALESCE($3, status)
       WHERE id = $1
       RETURNING id, name, status`,
      [groupId, name ?? null, status ?? null],
    );
    await recordAudit(client, req.user.id, saccoId, 'group.updated', 'group', groupId, {
      name: rows[0].name,
      status: rows[0].status,
    });
    await client.query('COMMIT');
    res.json({ group: { ...rows[0], id: Number(rows[0].id) } });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

router.patch('/groups/:groupId/sacco', async (req, res, next) => {
  if (!isPlatformAdmin(req.user.email)) return res.status(403).json({ error: 'Platform administrator access is required.' });
  const groupId = parseId(req.params.groupId);
  const saccoId = req.body.saccoId === null || req.body.saccoId === '' ? null : parseId(String(req.body.saccoId));
  if (!groupId) return res.status(400).json({ error: 'Group ID must be a positive integer.' });
  if (req.body.saccoId !== null && req.body.saccoId !== '' && saccoId === null) {
    return res.status(400).json({ error: 'SACCO ID must be a positive integer or null.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (saccoId !== null) {
      const { rows: saccos } = await client.query('SELECT id, status FROM saccos WHERE id = $1 FOR SHARE', [saccoId]);
      if (!saccos[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'SACCO not found.' });
      }
      if (saccos[0].status !== 'active') {
        await client.query('ROLLBACK');
        return res.status(423).json({ error: 'Groups cannot be assigned to a suspended SACCO.' });
      }
    }
    const { rows } = await client.query(
      `UPDATE chama_groups SET sacco_id = $2
       WHERE id = $1
       RETURNING id, name, sacco_id AS "saccoId"`,
      [groupId, saccoId],
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Savings group not found.' });
    }
    await recordAudit(client, req.user.id, saccoId, 'group.sacco_assigned', 'group', groupId, {});
    await client.query('COMMIT');
    res.json({ group: { ...rows[0], id: Number(rows[0].id), saccoId: rows[0].saccoId === null ? null : Number(rows[0].saccoId) } });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

router.get('/audit', async (req, res, next) => {
  const { platformAdmin, userId } = getAdminScope(req);
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.action, a.target_type AS "targetType",
              a.target_id AS "targetId", a.details, a.created_at AS "createdAt",
              s.id AS "saccoId", s.name AS "saccoName",
              u.full_name AS "actorName", u.email AS "actorEmail"
       FROM administration_audit a
       LEFT JOIN saccos s ON s.id = a.sacco_id
       LEFT JOIN users u ON u.id = a.actor_id
       WHERE $1::boolean OR EXISTS (
         SELECT 1 FROM sacco_administrators sa
         WHERE sa.sacco_id = a.sacco_id AND sa.user_id = $2
       )
       ORDER BY a.created_at DESC
       LIMIT 100`,
      [platformAdmin, userId],
    );
    res.json({ events: rows });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
