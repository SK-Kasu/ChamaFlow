const express = require('express');
const { pool } = require('./pool');
const { requireAuth } = require('./auth-middleware');
const { getSaccoIds, isPlatformAdmin, requireActiveSacco } = require('./admin-access');
const { toDateOnly, toNumber } = require('./serializers');

const router = express.Router();
const frequencies = new Set(['weekly', 'biweekly', 'monthly']);

function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateLabel(value) {
  const date = value instanceof Date ? value : new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short' }).format(date);
}

async function getMembership(groupId, userId, queryable = pool) {
  const { rows } = await queryable.query(
    `SELECT id, name, role, user_id AS "userId"
     FROM members
     WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId],
  );
  return rows[0] || null;
}

async function loadDashboard(groupId) {
  const groupResult = await pool.query(
    `SELECT id, name, contribution_amount AS "contributionAmount",
            cycle_number AS "cycleNumber", frequency,
            TO_CHAR(start_date, 'YYYY-MM-DD') AS "startDate",
            status, owner_id AS "ownerId"
     FROM chama_groups WHERE id = $1`,
    [groupId],
  );
  const group = groupResult.rows[0];
  if (!group) return null;

  const [membersResult, slotsResult, activityResult] = await Promise.all([
    pool.query(
      `SELECT m.id, m.name, m.role, m.trust_score AS "trustScore",
              EXISTS (
                SELECT 1 FROM contributions c
                WHERE c.member_id = m.id AND c.period_number = $2 AND c.status = 'paid'
              ) AS paid,
              u.email
       FROM members m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.group_id = $1
       ORDER BY m.id`,
      [groupId, group.cycleNumber],
    ),
    pool.query(
      `SELECT s.id, s.position, s.amount, TO_CHAR(s.payout_date, 'YYYY-MM-DD') AS "payoutDate", s.status,
              (l.id IS NOT NULL) AS "isListed", l.id AS "listingId",
              l.discount_amount AS "discountAmount", m.name AS "memberName"
       FROM payout_slots s
       JOIN members m ON m.id = s.member_id
       LEFT JOIN slot_listings l ON l.slot_id = s.id AND l.status = 'open'
       WHERE s.group_id = $1
       ORDER BY s.position`,
      [groupId],
    ),
    pool.query(
      `SELECT a.id, a.type, a.description AS title, a.amount,
              TO_CHAR(a.created_at, 'Mon DD, HH12:MI AM') AS "timeLabel"
       FROM activity a
       WHERE a.group_id = $1
       ORDER BY a.created_at DESC
       LIMIT 10`,
      [groupId],
    ),
  ]);

  const members = membersResult.rows.map((member) => ({
    ...member,
    trustScore: Number(member.trustScore),
    paid: Boolean(member.paid),
  }));
  const slots = slotsResult.rows.map((slot) => ({
    ...slot,
    payoutDate: toDateOnly(slot.payoutDate),
    payoutDateLabel: dateLabel(slot.payoutDate),
    isListed: Boolean(slot.isListed),
    amount: Number(slot.amount),
    discountAmount: Number(slot.discountAmount || 0),
  }));
  const paidContributions = members.filter((member) => member.paid).length;
  const contributionsResult = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM contributions
     WHERE group_id = $1 AND period_number = $2 AND status = 'paid'`,
    [groupId, group.cycleNumber],
  );

  return {
    prototypeMode: true,
    group: {
      ...group,
      contributionAmount: toNumber(group.contributionAmount),
      cycleNumber: Number(group.cycleNumber),
      startDate: toDateOnly(group.startDate),
      ownerId: undefined,
    },
    summary: {
      memberCount: members.length,
      paidContributions,
      contributionProgress: members.length ? Math.round((paidContributions / members.length) * 100) : 0,
      totalContributions: Number(contributionsResult.rows[0].total),
      activeListings: slots.filter((slot) => slot.isListed).length,
      cycleNumber: Number(group.cycleNumber),
    },
    members,
    slots,
    activity: activityResult.rows.map((item) => ({ ...item, amount: item.amount === null ? null : Number(item.amount) })),
  };
}

router.use(requireAuth);
router.use(requireActiveSacco);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.id, g.name, g.contribution_amount AS "contributionAmount",
              g.cycle_number AS "cycleNumber", g.frequency,
              TO_CHAR(g.start_date, 'YYYY-MM-DD') AS "startDate", COUNT(m.id)::INTEGER AS "memberCount"
       FROM chama_groups g
       JOIN members access_member ON access_member.group_id = g.id AND access_member.user_id = $1
       LEFT JOIN members m ON m.group_id = g.id
       GROUP BY g.id
       ORDER BY g.id`,
      [req.user.id],
    );
    res.json({
      groups: rows.map((row) => ({
        ...row,
        contributionAmount: toNumber(row.contributionAmount),
        cycleNumber: Number(row.cycleNumber),
        memberCount: Number(row.memberCount),
        startDate: toDateOnly(row.startDate),
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const amountText = String(req.body.contributionAmount ?? '');
  const amount = Number(amountText);
  const { frequency, startDate, members } = req.body;
  let saccoId = req.body.saccoId === undefined || req.body.saccoId === null || req.body.saccoId === ''
    ? null
    : parseId(String(req.body.saccoId));

  if (name.length < 2 || name.length > 100) {
    return res.status(400).json({ error: 'Group name must be between 2 and 100 characters.' });
  }
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(amountText) || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Contribution must be a positive amount with up to two decimal places.' });
  }
  if (!frequencies.has(frequency)) {
    return res.status(400).json({ error: 'Choose a weekly, biweekly, or monthly contribution schedule.' });
  }
  if (!validDate(startDate)) return res.status(400).json({ error: 'Choose a valid cycle start date.' });
  if (req.body.saccoId !== undefined && req.body.saccoId !== null && req.body.saccoId !== '' && !saccoId) {
    return res.status(400).json({ error: 'SACCO ID must be a positive integer.' });
  }
  if (!Array.isArray(members) || members.length < 2 || members.length > 100) {
    return res.status(400).json({ error: 'Add between 2 and 100 group members.' });
  }

  const memberNames = members.map((member) => (typeof member === 'string' ? member.trim() : ''));
  if (memberNames.some((member) => member.length < 2 || member.length > 100)) {
    return res.status(400).json({ error: 'Each member name must be between 2 and 100 characters.' });
  }
  if (new Set(memberNames.map((member) => member.toLocaleLowerCase())).size !== memberNames.length) {
    return res.status(400).json({ error: 'Member names must be unique within the group.' });
  }
  if (amount * memberNames.length > 9999999999.99) {
    return res.status(400).json({ error: 'The total payout is too large. Reduce the contribution or group size.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const platformAdmin = isPlatformAdmin(req.user.email);
    const administeredSaccos = await getSaccoIds(req.user.id, client);
    if (saccoId === null && administeredSaccos.length === 1) saccoId = administeredSaccos[0];
    if (saccoId !== null && !platformAdmin && !administeredSaccos.includes(saccoId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You are not an administrator of the selected SACCO.' });
    }
    if (saccoId !== null) {
      const saccoResult = await client.query(
        'SELECT status FROM saccos WHERE id = $1 FOR SHARE',
        [saccoId],
      );
      if (!saccoResult.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'SACCO not found.' });
      }
      if (saccoResult.rows[0].status !== 'active') {
        await client.query('ROLLBACK');
        return res.status(423).json({ error: 'This SACCO is suspended and cannot create groups.' });
      }
    }
    const groupResult = await client.query(
      `INSERT INTO chama_groups (owner_id, sacco_id, name, contribution_amount, frequency, start_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, contribution_amount AS "contributionAmount",
                 cycle_number AS "cycleNumber", frequency,
                 TO_CHAR(start_date, 'YYYY-MM-DD') AS "startDate", status`,
      [req.user.id, saccoId, name, amount, frequency, startDate],
    );
    const group = groupResult.rows[0];
    const payoutAmount = amount * memberNames.length;

    for (let index = 0; index < memberNames.length; index += 1) {
      const isCreator = index === 0;
      const memberResult = await client.query(
        `INSERT INTO members (group_id, user_id, name, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [group.id, isCreator ? req.user.id : null, memberNames[index], isCreator ? 'Administrator' : 'Member'],
      );
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
        [group.id, memberResult.rows[0].id, index + 1, startDate, frequency, payoutAmount],
      );
      await client.query(
        `INSERT INTO contributions (group_id, member_id, period_number, amount, due_date)
         VALUES ($1, $2, 1, $3, $4)`,
        [group.id, memberResult.rows[0].id, amount, startDate],
      );
    }
    await client.query(
      'INSERT INTO activity (group_id, member_id, type, description, amount) VALUES ($1, $2, $3, $4, $5)',
      [group.id, null, 'contribution', 'Savings circle created', amount],
    );
    await client.query('COMMIT');
    res.status(201).json({
      group: {
        ...group,
        contributionAmount: toNumber(group.contributionAmount),
        cycleNumber: Number(group.cycleNumber),
        startDate: toDateOnly(group.startDate),
        memberCount: memberNames.length,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

router.get('/:groupId/members', async (req, res, next) => {
  const groupId = parseId(req.params.groupId);
  if (!groupId) return res.status(400).json({ error: 'Group ID must be a positive integer.' });
  try {
    if (!await getMembership(groupId, req.user.id)) return res.status(404).json({ error: 'Savings group not found.' });
    const { rows } = await pool.query(
      `SELECT m.id, m.name, m.role, m.trust_score AS "trustScore", u.email
       FROM members m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.group_id = $1 ORDER BY m.id`,
      [groupId],
    );
    res.json({ members: rows.map((member) => ({ ...member, trustScore: Number(member.trustScore) })) });
  } catch (error) {
    next(error);
  }
});

router.post('/:groupId/members', async (req, res, next) => {
  const groupId = parseId(req.params.groupId);
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!groupId) return res.status(400).json({ error: 'Group ID must be a positive integer.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Enter the email address of an existing ChamaFlow account.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const membership = await getMembership(groupId, req.user.id, client);
    if (!membership || membership.role !== 'Administrator') {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Savings group not found.' });
    }

    const groupResult = await client.query(
      `SELECT id, contribution_amount AS "contributionAmount", frequency,
              TO_CHAR(start_date, 'YYYY-MM-DD') AS "startDate",
              cycle_number AS "cycleNumber"
       FROM chama_groups WHERE id = $1 FOR UPDATE`,
      [groupId],
    );
    const group = groupResult.rows[0];
    const targetResult = await client.query('SELECT id, full_name AS name, email FROM users WHERE LOWER(email) = $1', [email]);
    if (!targetResult.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No ChamaFlow account exists with that email yet.' });
    }
    const targetUser = targetResult.rows[0];
    const existing = await client.query('SELECT 1 FROM members WHERE group_id = $1 AND user_id = $2', [groupId, targetUser.id]);
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'That account is already a member of this group.' });
    }
    const locked = await client.query(
      `SELECT 1 FROM payout_slots WHERE group_id = $1 AND status = 'paid'
       UNION ALL
       SELECT 1 FROM contributions WHERE group_id = $1 AND status = 'paid'
       LIMIT 1`,
      [groupId],
    );
    if (locked.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Members can only be added before a payout or contribution is recorded. Add them in the next cycle instead.' });
    }

    const lastSlotResult = await client.query(
      'SELECT COALESCE(MAX(position), 0)::INTEGER AS position FROM payout_slots WHERE group_id = $1',
      [groupId],
    );
    const position = lastSlotResult.rows[0].position + 1;
    const memberResult = await client.query(
      `INSERT INTO members (group_id, user_id, name, role)
       VALUES ($1, $2, $3, 'Member')
       RETURNING id, name, role`,
      [groupId, targetUser.id, targetUser.name],
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
      [groupId, memberResult.rows[0].id, position, group.startDate, group.frequency, payoutAmount],
    );
    await client.query(
      'INSERT INTO contributions (group_id, member_id, period_number, amount, due_date) VALUES ($1, $2, $3, $4, $5)',
      [groupId, memberResult.rows[0].id, group.cycleNumber, group.contributionAmount, group.startDate],
    );
    await client.query(
      `UPDATE payout_slots SET amount = $2 WHERE group_id = $1 AND status = 'upcoming'`,
      [groupId, payoutAmount],
    );
    await client.query(
      'INSERT INTO activity (group_id, member_id, type, description, amount) VALUES ($1, $2, $3, $4, $5)',
      [groupId, memberResult.rows[0].id, 'contribution', `${targetUser.name} joined the circle`, group.contributionAmount],
    );
    await client.query('COMMIT');
    res.status(201).json({ member: { ...memberResult.rows[0], email: targetUser.email, trustScore: 70, paid: false } });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

router.get('/:groupId/dashboard', async (req, res, next) => {
  const groupId = parseId(req.params.groupId);
  if (!groupId) return res.status(400).json({ error: 'Group ID must be a positive integer.' });
  try {
    if (!await getMembership(groupId, req.user.id)) return res.status(404).json({ error: 'Savings group not found.' });
    const dashboard = await loadDashboard(groupId);
    if (!dashboard) return res.status(404).json({ error: 'Savings group not found.' });
    res.json(dashboard);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
