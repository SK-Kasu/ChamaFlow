const express = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('./pool');
const { requireAuth } = require('./auth-middleware');
const { getSaccoIds, isPlatformAdmin, requireActiveSacco } = require('./admin-access');
const { toDateOnly, toNumber } = require('./serializers');

const router = express.Router();
const frequencies = new Set(['weekly', 'biweekly', 'monthly']);
const discoveryLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many group searches. Try again shortly.' },
});
const joinRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many membership requests. Try again later.' },
});

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
              m.registration_number AS "registrationNumber",
              m.phone_number AS "phoneNumber", m.location,
              COALESCE(u.email, m.contact_email) AS email,
              EXISTS (
                SELECT 1 FROM contributions c
                WHERE c.member_id = m.id AND c.period_number = $2 AND c.status = 'paid'
              ) AS paid
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

router.get('/discover', discoveryLimiter, async (req, res, next) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 80) : '';
  const after = req.query.after === undefined ? 0 : parseId(String(req.query.after));
  if (after === null) return res.status(400).json({ error: 'Directory cursor must be a positive integer.' });
  try {
    const { rows } = await pool.query(
      `WITH public_groups AS (
         SELECT g.id, g.name, g.contribution_amount, g.frequency
         FROM chama_groups g
         LEFT JOIN saccos s ON s.id = g.sacco_id
         WHERE g.status = 'active'
           AND (s.id IS NULL OR s.status = 'active')
           AND g.id > $1
           AND ($2 = '' OR LOWER(g.name) LIKE $3)
         ORDER BY g.id
         LIMIT 21
       )
       SELECT g.id, g.name, g.contribution_amount AS "contributionAmount",
              g.frequency,
              (SELECT COUNT(*)::INTEGER FROM members m WHERE m.group_id = g.id) AS "memberCount"
       FROM public_groups g
       ORDER BY g.id`,
      [after, search, `${search.replace(/[\\%_]/g, '\\$&').toLowerCase()}%`],
    );
    const hasMore = rows.length > 20;
    const groups = rows.slice(0, 20).map((group) => ({
      ...group,
      id: Number(group.id),
      contributionAmount: toNumber(group.contributionAmount),
      memberCount: Number(group.memberCount),
    }));
    res.json({
      groups,
      nextCursor: hasMore ? groups[groups.length - 1].id : null,
    });
  } catch (error) {
    next(error);
  }
});

router.use(requireAuth);
router.use(requireActiveSacco);

router.get('/join-requests/mine', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.status, r.message, r.review_note AS "reviewNote",
              r.effective_cycle AS "effectiveCycle", r.applied_at AS "appliedAt",
              r.requested_at AS "requestedAt", r.reviewed_at AS "reviewedAt",
              g.id AS "groupId", g.name AS "groupName"
       FROM group_join_requests r
       JOIN chama_groups g ON g.id = r.group_id
       WHERE r.user_id = $1
       ORDER BY r.requested_at DESC, r.id DESC
       LIMIT 100`,
      [req.user.id],
    );
    res.json({ requests: rows });
  } catch (error) {
    next(error);
  }
});

router.post('/:groupId/join-requests', joinRequestLimiter, async (req, res, next) => {
  const groupId = parseId(req.params.groupId);
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (!groupId) return res.status(400).json({ error: 'Group ID must be a positive integer.' });
  if (message.length > 300) return res.status(400).json({ error: 'Message must be 300 characters or fewer.' });
  try {
    const { rows: groupsFound } = await pool.query(
      `SELECT g.id
       FROM chama_groups g
       LEFT JOIN saccos s ON s.id = g.sacco_id
       WHERE g.id = $1 AND g.status = 'active'
         AND (s.id IS NULL OR s.status = 'active')`,
      [groupId],
    );
    if (!groupsFound[0]) return res.status(404).json({ error: 'Savings group not found.' });

    const { rows: memberships } = await pool.query(
      'SELECT 1 FROM members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.user.id],
    );
    if (memberships.length) return res.status(409).json({ error: 'Your account is already linked to this group.' });

    const { rows } = await pool.query(
      `INSERT INTO group_join_requests (group_id, user_id, message)
       VALUES ($1, $2, $3)
       ON CONFLICT (group_id, user_id) DO UPDATE
       SET status = 'pending', message = EXCLUDED.message, review_note = NULL,
           target_member_id = NULL, effective_cycle = NULL, applied_at = NULL,
           requested_at = NOW(), reviewed_at = NULL, reviewed_by = NULL
       WHERE group_join_requests.status = 'rejected'
       RETURNING id, group_id AS "groupId", status, requested_at AS "requestedAt"`,
      [groupId, req.user.id, message],
    );
    if (!rows[0]) {
      const { rows: existing } = await pool.query(
        `SELECT id, status, effective_cycle AS "effectiveCycle"
         FROM group_join_requests WHERE group_id = $1 AND user_id = $2`,
        [groupId, req.user.id],
      );
      return res.status(409).json({ error: 'A membership request already exists for this group.', request: existing[0] });
    }
    res.status(201).json({ request: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.get('/:groupId/join-requests', async (req, res, next) => {
  const groupId = parseId(req.params.groupId);
  if (!groupId) return res.status(400).json({ error: 'Group ID must be a positive integer.' });
  try {
    const membership = await getMembership(groupId, req.user.id);
    if (!membership || membership.role !== 'Administrator') {
      return res.status(404).json({ error: 'Savings group not found.' });
    }
    const { rows } = await pool.query(
      `SELECT r.id, r.message, r.requested_at AS "requestedAt",
              u.full_name AS "applicantName", u.email AS "applicantEmail",
              COALESCE(candidates.members, '[]'::json) AS "availableMembers"
       FROM group_join_requests r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN LATERAL (
         SELECT JSON_AGG(JSONB_BUILD_OBJECT('id', m.id, 'name', m.name) ORDER BY m.id) AS members
         FROM members m
         WHERE m.group_id = r.group_id AND m.user_id IS NULL AND m.role <> 'Administrator'
           AND (m.contact_email IS NULL OR LOWER(m.contact_email) = LOWER(u.email))
           AND NOT EXISTS (
             SELECT 1 FROM group_join_requests assigned
             WHERE assigned.group_id = r.group_id AND assigned.target_member_id = m.id
               AND assigned.status = 'approved' AND assigned.applied_at IS NULL
           )
       ) candidates ON TRUE
       WHERE r.group_id = $1 AND r.status = 'pending'
       ORDER BY r.requested_at, r.id
       LIMIT 50`,
      [groupId],
    );
    res.json({ requests: rows });
  } catch (error) {
    next(error);
  }
});

router.patch('/:groupId/join-requests/:requestId', async (req, res, next) => {
  const groupId = parseId(req.params.groupId);
  const requestId = parseId(req.params.requestId);
  const decision = req.body.decision;
  const memberId = parseId(String(req.body.memberId ?? ''));
  const reviewNote = typeof req.body.reviewNote === 'string' ? req.body.reviewNote.trim() : '';
  if (!groupId || !requestId) return res.status(400).json({ error: 'Group and request IDs must be positive integers.' });
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'Choose approve or reject.' });
  if (decision === 'approve' && !memberId) return res.status(400).json({ error: 'Choose an unclaimed group roster member.' });
  if (reviewNote.length > 300) return res.status(400).json({ error: 'Review note must be 300 characters or fewer.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: groupRows } = await client.query(
      `SELECT g.id, g.cycle_number AS "cycleNumber", g.status,
              g.sacco_id AS "saccoId", s.status AS "saccoStatus"
       FROM chama_groups g LEFT JOIN saccos s ON s.id = g.sacco_id
       WHERE g.id = $1 FOR UPDATE OF g`,
      [groupId],
    );
    const group = groupRows[0];
    if (!group || group.status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Savings group not found.' });
    }
    if (group.saccoStatus === 'suspended') {
      await client.query('ROLLBACK');
      return res.status(423).json({ error: 'This SACCO is suspended. Membership requests cannot be reviewed.' });
    }
    const membership = await getMembership(groupId, req.user.id, client);
    if (!membership || membership.role !== 'Administrator') {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Savings group not found.' });
    }
    const { rows: requestRows } = await client.query(
      `SELECT r.id, r.user_id AS "userId", r.status, u.email AS "applicantEmail"
       FROM group_join_requests r JOIN users u ON u.id = r.user_id
       WHERE r.id = $1 AND r.group_id = $2 FOR UPDATE OF r`,
      [requestId, groupId],
    );
    const joinRequest = requestRows[0];
    if (!joinRequest || joinRequest.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This membership request is no longer pending.' });
    }

    if (decision === 'reject') {
      await client.query(
        `UPDATE group_join_requests
         SET status = 'rejected', review_note = $3, reviewed_at = NOW(), reviewed_by = $2
         WHERE id = $1`,
        [requestId, req.user.id, reviewNote || null],
      );
      await client.query(
        `INSERT INTO administration_audit (actor_id, sacco_id, action, target_type, target_id, details)
         VALUES ($1, $2, 'group.join_request_rejected', 'join_request', $3, $4::jsonb)`,
        [req.user.id, group.saccoId, String(requestId), JSON.stringify({ groupId })],
      );
      await client.query('COMMIT');
      return res.json({ request: { id: requestId, status: 'rejected' } });
    }

    const { rows: memberRows } = await client.query(
      `SELECT id, user_id AS "userId", contact_email AS "contactEmail", role
       FROM members WHERE id = $1 AND group_id = $2 FOR UPDATE`,
      [memberId, groupId],
    );
    const targetMember = memberRows[0];
    if (!targetMember || targetMember.userId || targetMember.role === 'Administrator'
      || (targetMember.contactEmail && targetMember.contactEmail.toLowerCase() !== joinRequest.applicantEmail.toLowerCase())) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Choose an unclaimed roster member whose email matches the applicant, if one is recorded.' });
    }
    const { rows: startedRows } = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM contributions WHERE group_id = $1 AND status = 'paid'
       ) OR EXISTS (
         SELECT 1 FROM payout_slots WHERE group_id = $1 AND status = 'paid'
       ) AS started`,
      [groupId],
    );
    const effectiveCycle = Number(group.cycleNumber) + (startedRows[0].started ? 1 : 0);
    if (effectiveCycle === Number(group.cycleNumber)) {
      const { rows: linkedRows } = await client.query(
        `UPDATE members SET user_id = $2
         WHERE id = $1 AND group_id = $3 AND user_id IS NULL
         RETURNING id`,
        [memberId, joinRequest.userId, groupId],
      );
      if (!linkedRows[0]) throw new Error('The selected roster entry was claimed by another account.');
    }
    await client.query(
      `UPDATE group_join_requests
       SET status = 'approved', target_member_id = $2, effective_cycle = $3,
           applied_at = CASE WHEN $3 = $4 THEN NOW() ELSE NULL END,
           review_note = $5, reviewed_at = NOW(), reviewed_by = $6
       WHERE id = $1`,
      [requestId, memberId, effectiveCycle, Number(group.cycleNumber), reviewNote || null, req.user.id],
    );
    await client.query(
      `INSERT INTO administration_audit (actor_id, sacco_id, action, target_type, target_id, details)
       VALUES ($1, $2, 'group.join_request_approved', 'join_request', $3, $4::jsonb)`,
      [req.user.id, group.saccoId, String(requestId), JSON.stringify({ groupId, memberId, effectiveCycle })],
    );
    await client.query('COMMIT');
    res.json({ request: { id: requestId, status: 'approved', effectiveCycle } });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'This roster member or account has already been linked.' });
    next(error);
  } finally {
    client.release();
  }
});

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

  const memberRecords = members.map((member) => {
    const record = typeof member === 'string' ? { name: member } : member;
    return {
      name: typeof record?.name === 'string' ? record.name.trim() : '',
      registrationNumber: typeof record?.registrationNumber === 'string' ? record.registrationNumber.trim() : '',
      phoneNumber: typeof record?.phoneNumber === 'string' ? record.phoneNumber.trim() : '',
      location: typeof record?.location === 'string' ? record.location.trim() : '',
      email: typeof record?.email === 'string' ? record.email.trim().toLowerCase() : '',
    };
  });
  if (memberRecords.some((member) => member.name.length < 2 || member.name.length > 100)) {
    return res.status(400).json({ error: 'Each member name must be between 2 and 100 characters.' });
  }
  if (memberRecords.some((member) => member.registrationNumber.length > 32
    || member.phoneNumber.length > 24 || member.location.length > 120
    || member.email.length > 254
    || (member.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email)))) {
    return res.status(400).json({ error: 'Check the member registration number, phone, location, and email details.' });
  }
  if (new Set(memberRecords.map((member) => member.name.toLocaleLowerCase())).size !== memberRecords.length) {
    return res.status(400).json({ error: 'Member names must be unique within the group.' });
  }
  const registrationNumbers = memberRecords.map((member) => member.registrationNumber.toLocaleLowerCase()).filter(Boolean);
  if (new Set(registrationNumbers).size !== registrationNumbers.length) {
    return res.status(400).json({ error: 'Registration numbers must be unique within the group.' });
  }
  if (amount * memberRecords.length > 9999999999.99) {
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
    const payoutAmount = amount * memberRecords.length;

    for (let index = 0; index < memberRecords.length; index += 1) {
      const isCreator = index === 0;
      const member = memberRecords[index];
      const memberResult = await client.query(
        `INSERT INTO members (
           group_id, user_id, name, role, registration_number,
           phone_number, location, contact_email
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          group.id, isCreator ? req.user.id : null, member.name,
          isCreator ? 'Administrator' : 'Member',
          member.registrationNumber || null, member.phoneNumber || null,
          member.location || null, member.email || null,
        ],
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
        memberCount: memberRecords.length,
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
      `SELECT m.id, m.name, m.role, m.trust_score AS "trustScore",
              m.registration_number AS "registrationNumber",
              m.phone_number AS "phoneNumber", m.location,
              COALESCE(u.email, m.contact_email) AS email
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
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const registrationNumber = typeof req.body.registrationNumber === 'string' ? req.body.registrationNumber.trim() : '';
  const phoneNumber = typeof req.body.phoneNumber === 'string' ? req.body.phoneNumber.trim() : '';
  const location = typeof req.body.location === 'string' ? req.body.location.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!groupId) return res.status(400).json({ error: 'Group ID must be a positive integer.' });
  if (name.length < 2 || name.length > 100) {
    return res.status(400).json({ error: 'Member name must be between 2 and 100 characters.' });
  }
  if (registrationNumber.length > 32 || phoneNumber.length > 24 || location.length > 120) {
    return res.status(400).json({ error: 'Check the member registration number, phone, and location details.' });
  }
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
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
              cycle_number AS "cycleNumber", status AS "groupStatus"
       FROM chama_groups WHERE id = $1 FOR UPDATE`,
      [groupId],
    );
    const group = groupResult.rows[0];
    if (!group || group.groupStatus !== 'active') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Members can only be added to an active group.' });
    }
    const targetResult = email
      ? await client.query('SELECT id, full_name AS name, email FROM users WHERE LOWER(email) = $1', [email])
      : { rows: [] };
    const targetUser = targetResult.rows[0] || null;
    if (targetUser) {
      const existing = await client.query('SELECT 1 FROM members WHERE group_id = $1 AND user_id = $2', [groupId, targetUser.id]);
      if (existing.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'That account is already a member of this group.' });
      }
    }
    if (registrationNumber) {
      const existingRegistration = await client.query(
        'SELECT 1 FROM members WHERE group_id = $1 AND LOWER(registration_number) = LOWER($2)',
        [groupId, registrationNumber],
      );
      if (existingRegistration.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'That registration number is already used in this group.' });
      }
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

    const positionResult = await client.query(
      `SELECT COALESCE(MAX(position), 0)::INTEGER AS position,
              COUNT(*)::INTEGER AS member_count
       FROM payout_slots WHERE group_id = $1`,
      [groupId],
    );
    const position = Number(positionResult.rows[0].position) + 1;
    if (Number(positionResult.rows[0].member_count) >= 100) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This group has reached the 100-member limit.' });
    }
    if (Number(group.contributionAmount) * position > 9999999999.99) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'The total payout is too large to add another member.' });
    }
    const memberResult = await client.query(
      `INSERT INTO members (
         group_id, user_id, name, role, registration_number,
         phone_number, location, contact_email
       )
       VALUES ($1, $2, $3, 'Member', $4, $5, $6, $7)
       RETURNING id, name, role, registration_number AS "registrationNumber",
                 phone_number AS "phoneNumber", location`,
      [
        groupId, targetUser?.id || null, name, registrationNumber || null,
        phoneNumber || null, location || null, email || null,
      ],
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
      [groupId, memberResult.rows[0].id, 'contribution', `${name} joined the circle`, group.contributionAmount],
    );
    await client.query('COMMIT');
    res.status(201).json({ member: { ...memberResult.rows[0], email: email || null, trustScore: 70, paid: false } });
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
