const express = require('express');
const { pool } = require('./pool');
const { requireAuth } = require('./auth-middleware');
const { requireActiveSacco } = require('./admin-access');
const { toDateOnly, toDateTime, toNumber } = require('./serializers');

const router = express.Router({ mergeParams: true });

function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

router.use(requireAuth);
router.use(requireActiveSacco);

router.get('/', async (req, res, next) => {
  const groupId = parseId(req.params.groupId);
  if (!groupId) return res.status(400).json({ error: 'Group ID must be a positive integer.' });
  try {
    const { rows: access } = await pool.query(
      'SELECT id, role FROM members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.user.id],
    );
    if (!access[0]) return res.status(404).json({ error: 'Savings group not found.' });

    const { rows } = await pool.query(
      `SELECT c.id, c.member_id AS "memberId", m.name AS "memberName",
              c.period_number AS "periodNumber", c.amount,
              TO_CHAR(c.due_date, 'YYYY-MM-DD') AS "dueDate",
              CASE WHEN c.status = 'pending' AND c.due_date < CURRENT_DATE THEN 'late'
                   ELSE c.status END AS status,
              c.payment_method AS "paymentMethod", c.paid_at AS "paidAt",
              p.status AS "paymentStatus", p.account_reference AS "paymentReference"
       FROM contributions c
       JOIN members m ON m.id = c.member_id
       LEFT JOIN LATERAL (
         SELECT status, account_reference
         FROM payment_transactions
         WHERE contribution_id = c.id AND transaction_type = 'collection'
         ORDER BY initiated_at DESC
         LIMIT 1
       ) p ON TRUE
       WHERE c.group_id = $1
       ORDER BY c.due_date DESC, m.name`,
      [groupId],
    );
    res.json({
      contributions: rows.map((row) => ({
        ...row,
        amount: toNumber(row.amount),
        dueDate: toDateOnly(row.dueDate),
        paidAt: toDateTime(row.paidAt),
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:contributionId/record-payment', async (req, res, next) => {
  const groupId = parseId(req.params.groupId);
  const contributionId = parseId(req.params.contributionId);
  if (!groupId || !contributionId) return res.status(400).json({ error: 'Group and contribution IDs must be positive integers.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: membershipRows } = await client.query(
      'SELECT id, role FROM members WHERE group_id = $1 AND user_id = $2 FOR SHARE',
      [groupId, req.user.id],
    );
    const membership = membershipRows[0];
    if (!membership) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Savings group not found.' });
    }

    const { rows } = await client.query(
      `SELECT c.id, c.group_id AS "groupId", c.member_id AS "memberId",
              c.period_number AS "periodNumber", c.amount, c.status, m.name AS "memberName"
       FROM contributions c
       JOIN members m ON m.id = c.member_id
       WHERE c.id = $1 AND c.group_id = $2
       FOR UPDATE OF c`,
      [contributionId, groupId],
    );
    const contribution = rows[0];
    if (!contribution) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Contribution not found.' });
    }
    if (membership.id !== contribution.memberId && membership.role !== 'Administrator' && membership.role !== 'Treasurer') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You can only record your own simulated contribution.' });
    }
    if (contribution.status === 'paid') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This contribution is already recorded as paid.' });
    }
    if (contribution.status === 'waived') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This contribution has been waived and cannot be paid.' });
    }
    const { rows: activePayments } = await client.query(
      `SELECT 1 FROM payment_transactions
       WHERE contribution_id = $1 AND transaction_type = 'collection'
         AND status IN ('initiated', 'pending', 'verification_required')
       LIMIT 1`,
      [contributionId],
    );
    if (activePayments.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A provider payment is already in progress or needs verification.' });
    }

    const result = await client.query(
      `UPDATE contributions
       SET status = 'paid', payment_method = 'simulated', paid_at = NOW(), recorded_by = $2
       WHERE id = $1
       RETURNING id, member_id AS "memberId", period_number AS "periodNumber",
                 amount, TO_CHAR(due_date, 'YYYY-MM-DD') AS "dueDate",
                 status, payment_method AS "paymentMethod", paid_at AS "paidAt"`,
      [contributionId, req.user.id],
    );
    await client.query(
      `INSERT INTO activity (group_id, member_id, type, description, amount)
       VALUES ($1, $2, 'contribution', $3, $4)`,
      [groupId, contribution.memberId, `${contribution.memberName} recorded a simulated contribution`, contribution.amount],
    );
    await client.query('COMMIT');
    res.json({
      contribution: {
        ...result.rows[0],
        amount: toNumber(result.rows[0].amount),
        dueDate: toDateOnly(result.rows[0].dueDate),
        paidAt: toDateTime(result.rows[0].paidAt),
      },
      simulated: true,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
