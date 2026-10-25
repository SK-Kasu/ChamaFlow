const { createHash, randomBytes, randomUUID } = require('node:crypto');
const express = require('express');
const { pool } = require('./pool');
const { requireAuth } = require('./auth-middleware');
const { requireActiveSacco } = require('./admin-access');
const { createDarajaClient, getSandboxConfig } = require('./daraja-client');
const { normalizeKenyanPhoneNumber, toMinorUnits } = require('./payment-utils');

const router = express.Router({ mergeParams: true });
const activeStates = ['initiated', 'pending', 'verification_required'];
const darajaClient = createDarajaClient();

function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function safePayment(row) {
  return {
    id: row.id,
    contributionId: Number(row.contributionId),
    accountReference: row.accountReference,
    amountMinor: Number(row.amountMinor),
    currency: row.currency,
    status: row.status,
    initiatedAt: row.initiatedAt,
    updatedAt: row.updatedAt,
    failureReason: row.status === 'failed' ? row.failureReason : null,
  };
}

function rowToSafePayment(row) {
  return safePayment({
    ...row,
    contributionId: row.contributionId,
    amountMinor: row.amountMinor,
  });
}

function isProviderSuccess(result) {
  return String(result?.ResponseCode) === '0'
    && String(result?.ResultCode) === '0';
}

function isProviderFailure(result) {
  return String(result?.ResponseCode) === '0'
    && result?.ResultCode !== undefined
    && result?.ResultCode !== null
    && String(result.ResultCode) !== '0';
}

async function auditPayment(client, paymentId, actorId, action, details = {}) {
  await client.query(
    `INSERT INTO payment_audit (payment_id, actor_id, action, details)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [paymentId, actorId || null, action, JSON.stringify(details)],
  );
}

async function applyProviderResult(paymentId, providerResult, eventId = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, group_id AS "groupId", contribution_id AS "contributionId",
              amount_minor AS "amountMinor", currency, status,
              provider_checkout_request_id AS "checkoutRequestId",
              initiated_by AS "initiatedBy"
       FROM payment_transactions
       WHERE id = $1
       FOR UPDATE`,
      [paymentId],
    );
    const payment = rows[0];
    if (!payment) {
      await client.query('ROLLBACK');
      return;
    }

    if (!activeStates.includes(payment.status)) {
      if (eventId) {
        await client.query(
          `UPDATE payment_provider_events
           SET processing_result = 'ignored', processed_at = NOW()
           WHERE id = $1`,
          [eventId],
        );
      }
      await client.query('COMMIT');
      return;
    }

    if (providerResult?.CheckoutRequestID
      && providerResult.CheckoutRequestID !== payment.checkoutRequestId) {
      await client.query(
        `UPDATE payment_transactions
         SET status = 'verification_required',
             failure_reason = 'Provider status reference did not match.',
             updated_at = NOW()
         WHERE id = $1`,
        [payment.id],
      );
      await auditPayment(client, payment.id, null, 'payment.reference_mismatch');
      if (eventId) {
        await client.query(
          `UPDATE payment_provider_events
           SET processing_result = 'verification_failed', processed_at = NOW()
           WHERE id = $1`,
          [eventId],
        );
      }
      await client.query('COMMIT');
      return;
    }

    const resultAmount = Number(providerResult?.Amount);
    if (Number.isFinite(resultAmount)
      && resultAmount * 100 !== Number(payment.amountMinor)) {
      await client.query(
        `UPDATE payment_transactions
         SET status = 'verification_required',
             failure_reason = 'Provider amount did not match the contribution.',
             updated_at = NOW()
         WHERE id = $1`,
        [payment.id],
      );
      await auditPayment(client, payment.id, null, 'payment.amount_mismatch');
      if (eventId) {
        await client.query(
          `UPDATE payment_provider_events
           SET processing_result = 'verification_failed', processed_at = NOW()
           WHERE id = $1`,
          [eventId],
        );
      }
      await client.query('COMMIT');
      return;
    }

    if (isProviderFailure(providerResult)) {
      await client.query(
        `UPDATE payment_transactions
         SET status = 'failed',
             failure_code = LEFT($2, 64),
             failure_reason = 'The provider reported that this payment did not complete.',
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [payment.id, String(providerResult.ResultCode)],
      );
      await auditPayment(client, payment.id, null, 'payment.provider_failed', {
        resultCode: String(providerResult.ResultCode),
      });
      if (eventId) {
        await client.query(
          `UPDATE payment_provider_events
           SET processing_result = 'verified', processed_at = NOW()
           WHERE id = $1`,
          [eventId],
        );
      }
      await client.query('COMMIT');
      return;
    }

    if (!isProviderSuccess(providerResult)) {
      await client.query(
        `UPDATE payment_transactions
         SET status = 'verification_required',
             failure_reason = 'Provider status is not final.',
             updated_at = NOW()
         WHERE id = $1`,
        [payment.id],
      );
      await auditPayment(client, payment.id, null, 'payment.status_unconfirmed');
      if (eventId) {
        await client.query(
          `UPDATE payment_provider_events
           SET processing_result = 'verification_failed', processed_at = NOW()
           WHERE id = $1`,
          [eventId],
        );
      }
      await client.query('COMMIT');
      return;
    }

    const { rows: contributionRows } = await client.query(
      `SELECT c.id, c.status, m.name AS "memberName"
       FROM contributions c
       JOIN members m ON m.id = c.member_id
       WHERE c.id = $1
       FOR UPDATE OF c`,
      [payment.contributionId],
    );
    if (!contributionRows[0]
      || ['paid', 'waived'].includes(contributionRows[0].status)) {
      await client.query(
        `UPDATE payment_transactions
         SET status = 'verification_required',
             failure_reason = 'Contribution was already recorded as paid; manual reconciliation is required.',
             updated_at = NOW()
         WHERE id = $1`,
        [payment.id],
      );
      await auditPayment(client, payment.id, null, 'payment.duplicate_collection_review');
      if (eventId) {
        await client.query(
          `UPDATE payment_provider_events
           SET processing_result = 'verification_failed', processed_at = NOW()
           WHERE id = $1`,
          [eventId],
        );
      }
      await client.query('COMMIT');
      return;
    }

    await client.query(
      `UPDATE contributions
       SET status = 'paid', payment_method = 'mpesa_sandbox',
           paid_at = NOW(), recorded_by = $2
       WHERE id = $1`,
      [payment.contributionId, payment.initiatedBy],
    );
    await client.query(
      `UPDATE payment_transactions
       SET status = 'succeeded', failure_code = NULL, failure_reason = NULL,
           completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [payment.id],
    );
    await client.query(
      `INSERT INTO activity (group_id, member_id, type, description, amount)
       SELECT c.group_id, c.member_id, 'contribution',
              m.name || ' completed an M-Pesa sandbox contribution',
              c.amount
       FROM contributions c
       JOIN members m ON m.id = c.member_id
       WHERE c.id = $1`,
      [payment.contributionId],
    );

    await client.query(
      `INSERT INTO ledger_accounts (group_id, code, currency)
       VALUES ($1, 'group_funds', $2), ($1, 'contributions_collected', $2)
       ON CONFLICT (group_id, code, currency) DO NOTHING`,
      [payment.groupId, payment.currency],
    );
    const { rows: ledgerAccounts } = await client.query(
      `SELECT id, code FROM ledger_accounts
       WHERE group_id = $1 AND currency = $2
         AND code IN ('group_funds', 'contributions_collected')`,
      [payment.groupId, payment.currency],
    );
    if (ledgerAccounts.length !== 2) {
      throw new Error('Could not initialize balanced payment ledger accounts.');
    }
    const accountIds = new Map(ledgerAccounts.map((account) => [account.code, account.id]));
    await client.query(
      `INSERT INTO ledger_entries (payment_id, account_id, amount_minor, currency)
       VALUES ($1, $2, $3, $4), ($1, $5, $6, $4)`,
      [
        payment.id,
        accountIds.get('group_funds'),
        payment.amountMinor,
        payment.currency,
        accountIds.get('contributions_collected'),
        -Number(payment.amountMinor),
      ],
    );
    await auditPayment(client, payment.id, null, 'payment.provider_confirmed', {
      amountMinor: Number(payment.amountMinor),
      currency: payment.currency,
    });
    if (eventId) {
      await client.query(
        `UPDATE payment_provider_events
         SET processing_result = 'verified', processed_at = NOW()
         WHERE id = $1`,
        [eventId],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function reconcileCheckout(checkoutRequestId, eventId = null) {
  const { rows } = await pool.query(
    `SELECT id FROM payment_transactions
     WHERE provider = 'daraja' AND provider_checkout_request_id = $1`,
    [checkoutRequestId],
  );
  if (!rows[0]) {
    if (eventId) {
      await pool.query(
        `UPDATE payment_provider_events
         SET processing_result = 'ignored', processed_at = NOW()
         WHERE id = $1`,
        [eventId],
      );
    }
    return;
  }

  const paymentId = rows[0].id;
  const payment = await pool.query(
    `SELECT provider_checkout_request_id AS "checkoutRequestId", status
     FROM payment_transactions WHERE id = $1`,
    [paymentId],
  );
  if (!payment.rows[0] || !activeStates.includes(payment.rows[0].status)) {
    if (eventId) {
      await pool.query(
        `UPDATE payment_provider_events
         SET processing_result = 'ignored', processed_at = NOW()
         WHERE id = $1`,
        [eventId],
      );
    }
    return;
  }

  try {
    const result = await darajaClient.queryStkPush(checkoutRequestId);
    await applyProviderResult(paymentId, result, eventId);
  } catch (error) {
    console.error('Daraja status verification failed:', error.message);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: changed } = await client.query(
        `UPDATE payment_transactions
         SET status = 'verification_required',
             failure_reason = 'Provider status could not be checked; reconciliation is required.',
             updated_at = NOW()
         WHERE id = $1 AND status IN ('initiated', 'pending', 'verification_required')
         RETURNING id`,
        [paymentId],
      );
      if (changed[0]) {
        await auditPayment(client, paymentId, null, 'payment.verification_required', {
          reason: 'provider_status_unavailable',
        });
      }
      if (eventId) {
        await client.query(
          `UPDATE payment_provider_events
           SET processing_result = 'verification_failed', processed_at = NOW()
           WHERE id = $1`,
          [eventId],
        );
      }
      await client.query('COMMIT');
    } catch (databaseError) {
      await client.query('ROLLBACK');
      throw databaseError;
    } finally {
      client.release();
    }
  }
}

router.use(requireAuth);
router.use(requireActiveSacco);

router.post('/:contributionId/payments', async (req, res, next) => {
  const groupId = parseId(req.params.groupId);
  const contributionId = parseId(req.params.contributionId);
  const phoneNumber = normalizeKenyanPhoneNumber(req.body?.phoneNumber);
  const idempotencyHeader = req.get('Idempotency-Key');
  const idempotencyKey = idempotencyHeader || randomUUID();
  if (!Number.isSafeInteger(groupId) || groupId <= 0
    || !Number.isSafeInteger(contributionId) || contributionId <= 0) {
    return res.status(400).json({ error: 'Group and contribution IDs must be positive integers.' });
  }
  if (!phoneNumber) return res.status(400).json({ error: 'Enter a valid Kenyan mobile number.' });
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) {
    return res.status(400).json({ error: 'The payment request key is invalid.' });
  }

  try {
    getSandboxConfig();
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }

  const client = await pool.connect();
  let payment;
  let amountKes;
  try {
    await client.query('BEGIN');
    const { rows: contributionRows } = await client.query(
      `SELECT c.id, c.amount, c.status, c.due_date AS "dueDate",
              g.status AS "groupStatus", m.id AS "memberId",
              ROUND(c.amount * 100)::BIGINT AS "amountMinor",
              (c.due_date <= CURRENT_DATE) AS "isDue"
       FROM contributions c
       JOIN chama_groups g ON g.id = c.group_id
       JOIN members m ON m.id = c.member_id
                    AND m.group_id = c.group_id
                    AND m.user_id = $3
       WHERE c.id = $1 AND c.group_id = $2
       FOR UPDATE OF c`,
      [contributionId, groupId, req.user.id],
    );
    const contribution = contributionRows[0];
    if (!contribution) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Contribution not found for this account.' });
    }

    const { rows: existingRequest } = await client.query(
      `SELECT id, contribution_id AS "contributionId",
              account_reference AS "accountReference", amount_minor AS "amountMinor",
              currency, status, initiated_at AS "initiatedAt", updated_at AS "updatedAt",
              failure_reason AS "failureReason"
       FROM payment_transactions
       WHERE group_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [groupId, idempotencyKey],
    );
    if (existingRequest[0]) {
      if (Number(existingRequest[0].contributionId) !== contributionId) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This payment request key was already used for another contribution.' });
      }
      await client.query('COMMIT');
      return res.status(200).json({ payment: rowToSafePayment(existingRequest[0]) });
    }

    if (contribution.groupStatus !== 'active') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Payments are disabled for this inactive group.' });
    }
    if (contribution.status === 'paid' || contribution.status === 'waived') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This contribution is not available for payment.' });
    }
    if (!contribution.isDue) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This contribution is not due yet.' });
    }

    const amountMinor = toMinorUnits(contribution.amount);
    if (!amountMinor || amountMinor !== Number(contribution.amountMinor) || amountMinor % 100 !== 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'M-Pesa sandbox collections require a whole-KES contribution amount.' });
    }
    amountKes = amountMinor / 100;

    const { rows: activePayments } = await client.query(
      `SELECT id, contribution_id AS "contributionId",
              account_reference AS "accountReference", amount_minor AS "amountMinor",
              currency, status, initiated_at AS "initiatedAt", updated_at AS "updatedAt",
              failure_reason AS "failureReason"
       FROM payment_transactions
       WHERE contribution_id = $1 AND transaction_type = 'collection'
         AND status = ANY($2::varchar[])
       FOR UPDATE`,
      [contributionId, activeStates],
    );
    if (activePayments[0]) {
      await client.query('COMMIT');
      return res.status(202).json({ payment: rowToSafePayment(activePayments[0]) });
    }

    const paymentId = randomUUID();
    const accountReference = `CF${randomBytes(5).toString('hex').toUpperCase()}`;
    const { rows: paymentRows } = await client.query(
      `INSERT INTO payment_transactions
         (id, group_id, contribution_id, transaction_type, provider, environment,
          amount_minor, currency, status, idempotency_key, account_reference, initiated_by)
       VALUES ($1, $2, $3, 'collection', 'daraja', 'sandbox',
               $4, 'KES', 'initiated', $5, $6, $7)
       RETURNING id, contribution_id AS "contributionId",
                 account_reference AS "accountReference", amount_minor AS "amountMinor",
                 currency, status, initiated_at AS "initiatedAt", updated_at AS "updatedAt",
                 failure_reason AS "failureReason"`,
      [paymentId, groupId, contributionId, amountMinor, idempotencyKey, accountReference, req.user.id],
    );
    payment = paymentRows[0];
    await client.query(
      `INSERT INTO payment_audit (payment_id, actor_id, action, details)
       VALUES ($1, $2, 'payment.initiated', $3::jsonb)`,
      [paymentId, req.user.id, JSON.stringify({ amountMinor, currency: 'KES', environment: 'sandbox' })],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      try {
        const { rows: reusedRequests } = await pool.query(
          `SELECT id, contribution_id AS "contributionId",
                  account_reference AS "accountReference", amount_minor AS "amountMinor",
                  currency, status, initiated_at AS "initiatedAt", updated_at AS "updatedAt",
                  failure_reason AS "failureReason"
           FROM payment_transactions
           WHERE group_id = $1 AND idempotency_key = $2`,
          [groupId, idempotencyKey],
        );
        if (reusedRequests[0]) {
          if (Number(reusedRequests[0].contributionId) !== contributionId) {
            return res.status(409).json({ error: 'This payment request key was already used for another contribution.' });
          }
          return res.status(202).json({ payment: rowToSafePayment(reusedRequests[0]) });
        }
        const { rows } = await pool.query(
          `SELECT id, contribution_id AS "contributionId",
                  account_reference AS "accountReference", amount_minor AS "amountMinor",
                  currency, status, initiated_at AS "initiatedAt", updated_at AS "updatedAt",
                  failure_reason AS "failureReason"
           FROM payment_transactions
           WHERE contribution_id = $1 AND transaction_type = 'collection'
             AND status = ANY($2::varchar[])
           ORDER BY initiated_at DESC LIMIT 1`,
          [contributionId, activeStates],
        );
        if (rows[0]) return res.status(202).json({ payment: rowToSafePayment(rows[0]) });
      } catch (readError) {
        return next(readError);
      }
    }
    return next(error);
  } finally {
    client.release();
  }

  async function markInitiationUnknown(error) {
    console.error('Daraja payment initiation outcome is unknown:', error.message);
    const updateClient = await pool.connect();
    try {
      await updateClient.query('BEGIN');
      const { rows } = await updateClient.query(
        `UPDATE payment_transactions
         SET status = 'verification_required',
             failure_reason = 'The provider outcome is unknown; verify before retrying.',
             updated_at = NOW()
         WHERE id = $1 AND status = 'initiated'
         RETURNING id, contribution_id AS "contributionId",
                   account_reference AS "accountReference", amount_minor AS "amountMinor",
                   currency, status, initiated_at AS "initiatedAt", updated_at AS "updatedAt",
                   failure_reason AS "failureReason"`,
        [payment.id],
      );
      if (rows[0]) await auditPayment(updateClient, payment.id, req.user.id, 'payment.verification_required');
      const current = rows[0] || (await updateClient.query(
        `SELECT id, contribution_id AS "contributionId",
                account_reference AS "accountReference", amount_minor AS "amountMinor",
                currency, status, initiated_at AS "initiatedAt", updated_at AS "updatedAt",
                failure_reason AS "failureReason"
         FROM payment_transactions WHERE id = $1`,
        [payment.id],
      )).rows[0];
      await updateClient.query('COMMIT');
      return res.status(202).json({
        payment: rowToSafePayment(current || payment),
        notice: 'The request outcome is being verified. Do not start another payment for this contribution.',
      });
    } catch (databaseError) {
      await updateClient.query('ROLLBACK');
      return next(databaseError);
    } finally {
      updateClient.release();
    }
  }

  let result;
  try {
    result = await darajaClient.initiateStkPush({
      amountKes,
      phoneNumber,
      accountReference: payment.accountReference,
      description: 'Chama contribution',
    });
  } catch (error) {
    return markInitiationUnknown(error);
  }

  if (result.ResponseCode === undefined || result.ResponseCode === null) {
    return markInitiationUnknown(new Error('Daraja did not return an acceptance status.'));
  }
  if (String(result.ResponseCode) !== '0') {
    const updateClient = await pool.connect();
    try {
      await updateClient.query('BEGIN');
      await updateClient.query(
        `UPDATE payment_transactions
         SET status = 'failed', failure_code = LEFT($2, 64),
             failure_reason = 'The provider rejected this payment request.',
             completed_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'initiated'`,
        [payment.id, String(result.ResponseCode || 'rejected')],
      );
      await auditPayment(updateClient, payment.id, req.user.id, 'payment.provider_rejected', {
        responseCode: String(result.ResponseCode || 'unknown'),
      });
      await updateClient.query('COMMIT');
      return res.status(502).json({ error: 'The M-Pesa sandbox rejected the payment request.' });
    } catch (error) {
      await updateClient.query('ROLLBACK');
      return next(error);
    } finally {
      updateClient.release();
    }
  }

  if (typeof result.CheckoutRequestID !== 'string'
    || typeof result.MerchantRequestID !== 'string') {
    return markInitiationUnknown(new Error('Daraja did not return request references.'));
  }
  const updateClient = await pool.connect();
  try {
    await updateClient.query('BEGIN');
    const { rows } = await updateClient.query(
      `UPDATE payment_transactions
       SET status = 'pending',
           provider_checkout_request_id = $2,
           provider_merchant_request_id = $3,
           updated_at = NOW()
       WHERE id = $1 AND status = 'initiated'
       RETURNING id, contribution_id AS "contributionId",
                 account_reference AS "accountReference", amount_minor AS "amountMinor",
                 currency, status, initiated_at AS "initiatedAt", updated_at AS "updatedAt",
                 failure_reason AS "failureReason"`,
      [payment.id, result.CheckoutRequestID, result.MerchantRequestID],
    );
    const current = rows[0] || (await updateClient.query(
      `SELECT id, contribution_id AS "contributionId",
              account_reference AS "accountReference", amount_minor AS "amountMinor",
              currency, status, initiated_at AS "initiatedAt", updated_at AS "updatedAt",
              failure_reason AS "failureReason"
       FROM payment_transactions WHERE id = $1`,
      [payment.id],
    )).rows[0];
    if (rows[0]) await auditPayment(updateClient, payment.id, req.user.id, 'payment.provider_accepted');
    await updateClient.query('COMMIT');
    return res.status(202).json({ payment: rowToSafePayment(current) });
  } catch (error) {
    await updateClient.query('ROLLBACK');
    return markInitiationUnknown(error);
  } finally {
    updateClient.release();
  }
});

router.get('/:contributionId/payments/:paymentId', async (req, res, next) => {
  const groupId = parseId(req.params.groupId);
  const contributionId = parseId(req.params.contributionId);
  const paymentId = req.params.paymentId;
  if (!groupId || !contributionId
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paymentId)) {
    return res.status(400).json({ error: 'Payment reference is invalid.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.contribution_id AS "contributionId",
              p.account_reference AS "accountReference", p.amount_minor AS "amountMinor",
              p.currency, p.status, p.initiated_at AS "initiatedAt",
              p.updated_at AS "updatedAt", p.failure_reason AS "failureReason",
              p.provider_checkout_request_id AS "checkoutRequestId",
              (p.updated_at < NOW() - INTERVAL '30 seconds') AS "canReconcile"
       FROM payment_transactions p
       JOIN members m ON m.group_id = p.group_id AND m.user_id = $4
       WHERE p.id = $1 AND p.group_id = $2 AND p.contribution_id = $3`,
      [paymentId, groupId, contributionId, req.user.id],
    );
    const payment = rows[0];
    if (!payment) return res.status(404).json({ error: 'Payment not found.' });
    if (payment.canReconcile && payment.checkoutRequestId
      && activeStates.includes(payment.status)) {
      await reconcileCheckout(payment.checkoutRequestId);
      const { rows: refreshed } = await pool.query(
        `SELECT id, contribution_id AS "contributionId",
                account_reference AS "accountReference", amount_minor AS "amountMinor",
                currency, status, initiated_at AS "initiatedAt",
                updated_at AS "updatedAt", failure_reason AS "failureReason"
         FROM payment_transactions WHERE id = $1`,
        [paymentId],
      );
      return res.json({ payment: rowToSafePayment(refreshed[0]) });
    }
    return res.json({ payment: rowToSafePayment(payment) });
  } catch (error) {
    next(error);
  }
});

const callbackRouter = express.Router();
callbackRouter.post('/callback', async (req, res, next) => {
  const callback = req.body?.Body?.stkCallback;
  const checkoutRequestId = callback?.CheckoutRequestID;
  if (typeof checkoutRequestId !== 'string' || checkoutRequestId.length > 128) {
    return res.status(400).json({ error: 'Callback did not contain a valid checkout reference.' });
  }

  const payloadHash = createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
  try {
    const { rows: paymentRows } = await pool.query(
      `SELECT id FROM payment_transactions
       WHERE provider = 'daraja' AND provider_checkout_request_id = $1`,
      [checkoutRequestId],
    );
    const { rows: eventRows } = await pool.query(
      `INSERT INTO payment_provider_events
         (provider, payment_id, checkout_request_id, payload_sha256, event_type)
       VALUES ('daraja', $1, $2, $3, 'stk_callback')
       ON CONFLICT (provider, payload_sha256) DO UPDATE
         SET received_at = payment_provider_events.received_at
       RETURNING id`,
      [paymentRows[0]?.id || null, checkoutRequestId, payloadHash],
    );
    await reconcileCheckout(checkoutRequestId, eventRows[0]?.id || null);
    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Callback received.' });
  } catch (error) {
    next(error);
  }
});

module.exports = {
  callbackRouter,
  isProviderFailure,
  isProviderSuccess,
  paymentRouter: router,
};
