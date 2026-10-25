const express = require('express');
const { pool } = require('./pool');
const { requireAuth } = require('./auth-middleware');
const { requireActiveSacco } = require('./admin-access');
const { toDateOnly, toNumber } = require('./serializers');

const router = express.Router({ mergeParams: true });

function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

async function getMember(groupId, userId, queryable = pool) {
  const { rows } = await queryable.query(
    'SELECT id, role FROM members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId],
  );
  return rows[0] || null;
}

router.use(requireAuth);
router.use(requireActiveSacco);

router.get('/listings', async (req, res, next) => {
  const groupId = parseId(req.params.groupId);
  if (!groupId) return res.status(400).json({ error: 'Group ID must be a positive integer.' });
  try {
    if (!await getMember(groupId, req.user.id)) return res.status(404).json({ error: 'Savings group not found.' });
    const { rows } = await pool.query(
      `SELECT l.id, l.slot_id AS "slotId", l.discount_amount AS "discountAmount",
              l.created_at AS "createdAt", s.position, s.amount,
              TO_CHAR(s.payout_date, 'YYYY-MM-DD') AS "payoutDate",
              m.name AS "memberName", l.listed_by AS "listedBy",
              COUNT(i.id)::INTEGER AS "interestCount"
       FROM slot_listings l
       JOIN payout_slots s ON s.id = l.slot_id
       JOIN members m ON m.id = l.listed_by
       LEFT JOIN slot_listing_interests i ON i.listing_id = l.id AND i.status = 'pending'
       WHERE l.group_id = $1 AND l.status = 'open' AND s.status = 'upcoming'
       GROUP BY l.id, s.id, m.id
       ORDER BY s.payout_date`,
      [groupId],
    );
    res.json({
      listings: rows.map((row) => ({
        ...row,
        amount: toNumber(row.amount),
        discountAmount: toNumber(row.discountAmount),
        payoutDate: toDateOnly(row.payoutDate),
        payoutDateLabel: new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short' }).format(new Date(`${row.payoutDate}T12:00:00`)),
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:slotId/listings', async (req, res, next) => {
  const groupId = parseId(req.params.groupId);
  const slotId = parseId(req.params.slotId);
  const discountText = String(req.body.discountAmount ?? '0');
  const discountAmount = Number(discountText);
  if (!groupId || !slotId) return res.status(400).json({ error: 'Group and slot IDs must be positive integers.' });
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(discountText) || !Number.isFinite(discountAmount) || discountAmount < 0) {
    return res.status(400).json({ error: 'Discount must be zero or a positive amount with up to two decimal places.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const member = await getMember(groupId, req.user.id, client);
    if (!member) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Savings group not found.' });
    }
    const { rows } = await client.query(
      `SELECT id, member_id AS "memberId", amount, status
       FROM payout_slots WHERE id = $1 AND group_id = $2 FOR UPDATE`,
      [slotId, groupId],
    );
    const slot = rows[0];
    if (!slot) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Payout slot not found.' });
    }
    if (slot.memberId !== member.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You can only list your own payout slot.' });
    }
    if (slot.status !== 'upcoming') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Only upcoming payout slots can be listed.' });
    }
    if (discountAmount > Number(slot.amount)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Discount cannot exceed the payout amount.' });
    }
    const { rows: listingRows } = await client.query(
      `INSERT INTO slot_listings (group_id, slot_id, listed_by, discount_amount)
       VALUES ($1, $2, $3, $4)
       RETURNING id, slot_id AS "slotId", discount_amount AS "discountAmount",
                 status, created_at AS "createdAt"`,
      [groupId, slotId, member.id, discountAmount],
    );
    await client.query('COMMIT');
    res.status(201).json({
      listing: {
        ...listingRows[0],
        discountAmount: toNumber(listingRows[0].discountAmount),
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'This payout slot already has an active listing.' });
    next(error);
  } finally {
    client.release();
  }
});

router.delete('/listings/:listingId', async (req, res, next) => {
  const groupId = parseId(req.params.groupId);
  const listingId = parseId(req.params.listingId);
  if (!groupId || !listingId) return res.status(400).json({ error: 'Group and listing IDs must be positive integers.' });
  try {
    const member = await getMember(groupId, req.user.id);
    if (!member) return res.status(404).json({ error: 'Savings group not found.' });
    const { rows } = await pool.query(
      `UPDATE slot_listings
       SET status = 'cancelled', closed_at = NOW()
       WHERE id = $1 AND group_id = $2 AND status = 'open'
         AND (listed_by = $3 OR $4 = 'Administrator')
       RETURNING id`,
      [listingId, groupId, member.id, member.role],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Active listing not found.' });
    res.json({ message: 'Listing cancelled.' });
  } catch (error) {
    next(error);
  }
});

router.post('/:slotId/record-payout', async (req, res, next) => {
  const groupId = parseId(req.params.groupId);
  const slotId = parseId(req.params.slotId);
  if (!groupId || !slotId) return res.status(400).json({ error: 'Group and slot IDs must be positive integers.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const member = await getMember(groupId, req.user.id, client);
    if (!member || member.role !== 'Administrator') {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Savings group not found.' });
    }
    const { rows: groupRows } = await client.query(
      `SELECT id, cycle_number AS "cycleNumber", frequency
       FROM chama_groups WHERE id = $1 FOR UPDATE`,
      [groupId],
    );
    const group = groupRows[0];
    const { rows: slotRows } = await client.query(
      `SELECT s.id, s.member_id AS "memberId", s.position, s.amount, s.status, m.name AS "memberName"
       FROM payout_slots s JOIN members m ON m.id = s.member_id
       WHERE s.id = $1 AND s.group_id = $2 FOR UPDATE OF s`,
      [slotId, groupId],
    );
    const slot = slotRows[0];
    if (!slot) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Payout slot not found.' });
    }
    if (slot.status !== 'upcoming') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This payout slot has already been recorded.' });
    }
    const { rows: nextSlots } = await client.query(
      `SELECT position FROM payout_slots
       WHERE group_id = $1 AND status = 'upcoming'
       ORDER BY position LIMIT 1`,
      [groupId],
    );
    if (nextSlots[0]?.position !== slot.position) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Payouts must be recorded in the scheduled slot order.' });
    }
    const { rows: contributionRows } = await client.query(
      `SELECT COUNT(*)::INTEGER AS total,
              COUNT(*) FILTER (WHERE status = 'paid')::INTEGER AS paid,
              COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) AS "paidAmount"
       FROM contributions WHERE group_id = $1 AND period_number = $2`,
      [groupId, group.cycleNumber],
    );
    const contributions = contributionRows[0];
    if (contributions.total === 0 || contributions.paid !== contributions.total) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'All scheduled contributions must be recorded before a payout can be recorded.' });
    }
    if (Number(contributions.paidAmount) !== Number(slot.amount)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'The recorded contribution total does not match this payout amount.' });
    }

    await client.query(
      `UPDATE payout_slots SET status = 'paid', paid_at = NOW(), recorded_by = $2 WHERE id = $1`,
      [slot.id, req.user.id],
    );
    await client.query(
      `INSERT INTO activity (group_id, member_id, type, description, amount)
       VALUES ($1, $2, 'payout', $3, $4)`,
      [groupId, slot.memberId, `${slot.memberName} received a simulated payout`, slot.amount],
    );

    const { rows: pendingSlots } = await client.query(
      `SELECT id FROM payout_slots WHERE group_id = $1 AND status = 'upcoming' LIMIT 1`,
      [groupId],
    );
    let nextCycle = null;
    if (!pendingSlots.length) {
      const { rows: finalDateRows } = await client.query(
        'SELECT MAX(payout_date) AS "lastPayoutDate", COUNT(*)::INTEGER AS "memberCount" FROM payout_slots WHERE group_id = $1',
        [groupId],
      );
      const finalDate = finalDateRows[0].lastPayoutDate;
      const nextCycleNumber = group.cycleNumber + 1;
      const intervalName = group.frequency === 'weekly' ? '1 week' : group.frequency === 'biweekly' ? '2 weeks' : '1 month';
      const { rows: firstDateRows } = await client.query(
        `SELECT TO_CHAR(($1::date + INTERVAL '${intervalName}')::date, 'YYYY-MM-DD') AS "firstDate"`,
        [finalDate],
      );
      const firstDate = firstDateRows[0].firstDate;

      await client.query(
        `UPDATE payout_slots
         SET status = 'upcoming', paid_at = NULL, recorded_by = NULL,
             payout_date = ($2::date + ((position - 1) * CASE $3
               WHEN 'weekly' THEN INTERVAL '1 week'
               WHEN 'biweekly' THEN INTERVAL '2 weeks'
               ELSE INTERVAL '1 month'
             END))::date,
             amount = $4
         WHERE group_id = $1`,
        [groupId, firstDate, group.frequency, Number(slot.amount)],
      );
      await client.query('UPDATE chama_groups SET cycle_number = $2 WHERE id = $1', [groupId, nextCycleNumber]);
      await client.query(
        `UPDATE slot_listings SET status = 'closed', closed_at = NOW()
         WHERE group_id = $1 AND status = 'open'`,
        [groupId],
      );
      const { rows: members } = await client.query('SELECT id FROM members WHERE group_id = $1 ORDER BY id', [groupId]);
      for (const cycleMember of members) {
        await client.query(
          `INSERT INTO contributions (group_id, member_id, period_number, amount, due_date)
           VALUES ($1, $2, $3, $4, $5)`,
          [groupId, cycleMember.id, nextCycleNumber, slot.amount / members.length, firstDate],
        );
      }
      nextCycle = { cycleNumber: nextCycleNumber, startsOn: firstDate };
    }

    await client.query('COMMIT');
    res.json({
      payout: { slotId: slot.id, memberName: slot.memberName, amount: toNumber(slot.amount), simulated: true },
      nextCycle: nextCycle && {
        ...nextCycle,
        startsOn: toDateOnly(nextCycle.startsOn),
      },
      notice: 'This records a prototype payout only. No funds were transferred.',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

router.post('/listings/:listingId/interests', async (req, res, next) => {
  const groupId = parseId(req.params.groupId);
  const listingId = parseId(req.params.listingId);
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (!groupId || !listingId) return res.status(400).json({ error: 'Group and listing IDs must be positive integers.' });
  if (message.length > 300) return res.status(400).json({ error: 'Message must be 300 characters or fewer.' });

  try {
    const member = await getMember(groupId, req.user.id);
    if (!member) return res.status(404).json({ error: 'Savings group not found.' });
    const { rows: listings } = await pool.query(
      `SELECT id, listed_by AS "listedBy"
       FROM slot_listings WHERE id = $1 AND group_id = $2 AND status = 'open'`,
      [listingId, groupId],
    );
    const listing = listings[0];
    if (!listing) return res.status(404).json({ error: 'Active slot listing not found.' });
    if (listing.listedBy === member.id) return res.status(400).json({ error: 'You cannot express interest in your own listing.' });

    const { rows } = await pool.query(
      `INSERT INTO slot_listing_interests (listing_id, member_id, message)
       VALUES ($1, $2, $3)
       ON CONFLICT (listing_id, member_id)
       DO UPDATE SET message = EXCLUDED.message, status = 'pending', created_at = NOW()
       RETURNING id, listing_id AS "listingId", status, created_at AS "createdAt"`,
      [listingId, member.id, message || null],
    );
    res.status(201).json({
      interest: rows[0],
      notice: 'Interest was recorded for discussion only. No payout position or funds were transferred.',
    });
  } catch (error) {
    next(error);
  }
});

router.get('/listings/:listingId/interests', async (req, res, next) => {
  const groupId = parseId(req.params.groupId);
  const listingId = parseId(req.params.listingId);
  if (!groupId || !listingId) return res.status(400).json({ error: 'Group and listing IDs must be positive integers.' });
  try {
    const member = await getMember(groupId, req.user.id);
    if (!member) return res.status(404).json({ error: 'Savings group not found.' });
    const { rows: listings } = await pool.query(
      'SELECT listed_by FROM slot_listings WHERE id = $1 AND group_id = $2',
      [listingId, groupId],
    );
    if (!listings[0]) return res.status(404).json({ error: 'Slot listing not found.' });
    if (listings[0].listed_by !== member.id && member.role !== 'Administrator') {
      return res.status(403).json({ error: 'Only the listing owner or group administrator can view expressions of interest.' });
    }
    const { rows } = await pool.query(
      `SELECT i.id, i.message, i.status, i.created_at AS "createdAt",
              m.id AS "memberId", m.name AS "memberName"
       FROM slot_listing_interests i
       JOIN members m ON m.id = i.member_id
       WHERE i.listing_id = $1
       ORDER BY i.created_at DESC`,
      [listingId],
    );
    res.json({ interests: rows });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
