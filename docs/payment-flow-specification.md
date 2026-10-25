# ChamaFlow payment flow specification

**Status:** Daraja sandbox contribution collection is implemented; live funds and automated payouts are not enabled or approved  
**Scope:** M-Pesa collections and scheduled payouts for savings groups operating their own M-Pesa business accounts  
**Initial scale:** At least 10 groups and 1,000 member places, with growth expected  
**Currency:** KES for the initial launch

**Implementation note (2026-10-25):** The backend now supports sandbox STK Push attempts, provider-status queries, idempotent per-contribution attempts, callback hashing without retaining callback payloads, and append-only balanced ledger postings after a successful provider query. The sandbox shortcode is application-configured for testing; group-owned provider account configuration is not modeled. The browser labels these as sandbox transactions; they do not represent live funds. Live provider configuration is rejected by both the backend and the payment database schema. Durable background reconciliation, payout automation, callback authentication confirmation, operator reconciliation tooling, and the remaining Phase 0 launch gates are not implemented.

This document describes intended behavior. It is not a claim that ChamaFlow currently processes payments, nor legal, regulatory, tax, or provider-integration advice. Confirm the exact account setup and API products with Safaricom or an approved provider, and get qualified local compliance advice before accepting live funds.

## 1. Product and funds model

- Each group controls its own M-Pesa business account and funds.
- A group's collections are directed to that group's configured account. Its payouts are funded from that same account.
- ChamaFlow records instructions, provider responses, and reconciliation results. It does not hold pooled funds, operate escrow, or represent an app balance as withdrawable money.
- A payment is not considered collected or paid based only on a button click, an STK Push request, a client redirect, or an unverified callback.
- Contributions and payouts must be visibly labelled **simulated** until live provider flows have been implemented, tested, and enabled for the relevant group.
- Yield, interest, wallet balances, slot trading, lending, and automated penalties are outside this first payment release.

## 2. Decisions and launch gates

### Confirmed for planning

- Account model: each savings group controls its own M-Pesa business account.
- Live provider: not selected. Daraja is recommended for sandbox evaluation below; account-specific approval and operating requirements remain open Phase 0 launch gates.

### Provider research and recommendation

**Recommendation: use Safaricom Daraja directly for Phase 1 sandbox work. Do not enable live payments yet.** The official catalogue documents the required collection, disbursement, and status-query products. Direct integration also fits the intended model in which each group owns and controls its own funds. This is a technical recommendation, not Safaricom approval for ChamaFlow to operate across multiple groups.

Findings from the [Daraja API catalogue](https://developer.safaricom.co.ke/apis) and its product documentation, reviewed 2026-10-23:

- **Collections:** [M-Pesa Express (STK Push)](https://developer.safaricom.co.ke/apis/MpesaExpressSimulate) is described as a merchant/business-initiated C2B payment. The business supplies its shortcode, amount, member phone number, and callback URL; Safaricom sends the payment prompt and returns the processed result asynchronously. The documented production prerequisites include a live PayBill/Till and business operators. The request-accepted response is not the final payment result.
- **Payouts:** [Business To Customer (B2C)](https://developer.safaricom.co.ke/apis/BusinessToCustomer) supports asynchronous disbursement to a customer's M-Pesa number. Its live prerequisites say a business needs a B2C shortcode, or an existing PayBill/Till converted to a single account that can receive and disburse, with the required business operators. This means the group-owned account model is supported in principle, provided each group's account is individually eligible and provisioned; it does not mean any existing PayBill/Till can automatically send B2C payouts.
- **Recovery and reconciliation:** [M-Pesa Express Query](https://developer.safaricom.co.ke/apis/MpesaExpressQuery) queries an STK request by its checkout request ID. [Transaction Status](https://developer.safaricom.co.ke/apis/TransactionStatus) is asynchronous, accepts a receipt number or original conversation ID, and covers C2B and B2C among other transaction types. Treat both as recovery/reconciliation mechanisms, not synchronous proof from the initial request.
- **Duplicate payout protection:** the B2C request requires a merchant-generated unique `OriginatorConversationID`; its documentation says this identifies the request and can be used to check status before another disbursement. Preserve one internal payout instruction and its identifier across retries. The docs do not establish a general exactly-once guarantee, so an unknown outcome must be queried/reconciled before retrying.
- **Callback security remains unverified:** the reviewed product pages describe callback/result URLs and payloads but do not establish a callback signature, authenticated sender identity, replay protection, or delivery/retry guarantees. ChamaFlow must not credit a payment based on an unverified callback. Obtain Safaricom's documented callback-verification and delivery guidance before implementing the live callback trust boundary.
- **Do not confuse C2B URL registration with STK callbacks:** Daraja's [C2B product](https://developer.safaricom.co.ke/apis/CustomerToBusiness) registers confirmation/optional validation URLs for customer payments made to a PayBill/Till. M-Pesa Express instead takes a callback URL on its STK request. The C2B registration API is not a substitute for the STK callback flow.

Before live implementation or enablement, Safaricom must confirm:

1. Whether one Daraja application/integration and authorized operator relationship may serve multiple independently owned group shortcodes, and what authorization each group must grant.
2. For each group, the exact account product and provisioning needed for both M-Pesa Express collections and B2C disbursements to work against the same group-controlled funds.
3. How credentials, initiator users, roles, limits, and callback configuration are provisioned and isolated per group; which party is permitted to operate the APIs on the group's behalf.
4. Callback authentication, callback delivery/retry behavior, status-query availability and timing, duplicate-request handling, reversals, fees, and disbursement limits for the approved account setup.
5. Whether the intended group-to-member payout use case is permitted for those accounts and what approvals or contractual terms apply.

Until those points are confirmed, keep the current prototype in simulation mode. Sandbox work may proceed with Safaricom's test app and test data, but use no production credentials or real funds.

### Agreed initial behavior

- Collection: a member initiates a contribution payment from the app using an STK Push to the member's M-Pesa line.
- Payout: scheduled payout is automatically initiated only after every required contribution for the cycle is confirmed and the payout is due.
- Payout destination: the scheduled beneficiary's verified M-Pesa number.
- Group funds: the group's own configured M-Pesa business account.
- A failed, pending, reversed, or unmatched transaction does not count as a confirmed contribution or completed payout.

Provider approval, operating permissions, and the open account and callback questions above remain launch gates. Do not put provider credentials in source control, browser code, logs, or user-visible responses.

## 3. Actors and permissions

- **Member:** views group obligations and initiates only their own contribution payment.
- **Group administrator:** configures group payment account details and schedule, manages membership, and can pause group payment automation. Configuration changes require step-up authentication and an audit event.
- **Treasurer:** can view payment and reconciliation details and manage operational exceptions if the group grants this role. The precise role/permission model must be finalized before live rollout.
- **ChamaFlow payment service:** creates provider requests, receives and validates provider events, updates transaction state, schedules eligible payouts, and reconciles provider records. It must not make a payment decision based on browser-supplied status.
- **Payment provider:** executes the collection or disbursement and is the source of provider transaction identifiers and final provider status.

All administrative actions must be scoped to groups the authenticated user is authorized to administer. Never trust a client-supplied group, member, amount, beneficiary, or status without loading and validating the corresponding server-side records.

## 4. Contribution collection flow

### 4.1 Start a collection

1. The member signs in and selects a group contribution currently due for that member.
2. The server confirms the member's group membership, contribution period, due amount, currency, and current status. The amount and destination are taken from server-side records and group payment configuration.
3. The server creates a durable internal payment record in `initiated` state with a unique internal ID/idempotency key. It records the group, member, contribution, amount in minor units, currency, and a non-secret reference that can be matched to provider reporting.
4. The member confirms the M-Pesa phone number to prompt. ChamaFlow sends the request to the provider using the group's configured collection account.
5. The interface displays **Pending confirmation** and does not mark the contribution paid.
6. The server stores the provider request/checkout reference and advances the payment to `pending` only after receiving a valid provider response that the request was accepted for processing.

Repeated taps and network retries must reuse the same active payment attempt or safely return its status. They must not create a second charge for the same contribution while the first attempt's outcome is unknown.

### 4.2 Confirm a collection

1. The provider sends a callback, or the service queries the provider using a supported status-query mechanism.
2. The backend validates the callback/request according to the provider's documented authentication mechanism and verifies that the transaction maps to a known internal attempt.
3. The backend checks the expected group account, amount, currency, contribution reference, and provider transaction ID. A mismatch is quarantined for investigation; it is not credited.
4. Within one database transaction, the backend records the provider event and unique provider transaction ID, transitions the payment once to `succeeded`, marks the related contribution paid, and appends the corresponding financial ledger entries and audit event.
5. The member and authorized group users are notified of the confirmed result. Notifications are informational; the database/provider-verified status remains authoritative.

Callbacks may be duplicated, delayed, or arrive out of order. Processing must be idempotent. Replaying a callback must not create another contribution credit or ledger posting.

### 4.3 Collection outcomes

- **Rejected before provider acceptance:** record the rejection; do not mark the contribution paid.
- **User cancels or does not complete the prompt:** retain an appropriate terminal/expired state only when supported by provider evidence. Allow a new attempt after the previous one is known not to have succeeded.
- **Timeout or unknown provider outcome:** show `pending`/`verification_required`. Query or reconcile before allowing a new attempt; never assume a timeout means failure.
- **Confirmed success:** mark paid once after verified provider confirmation.
- **Reversal/refund:** append a compensating transaction, preserve the original payment history, and update the contribution according to group policy. Never erase the original successful payment.
- **Wrong amount, account, or unmatched reference:** quarantine for manual reconciliation; do not silently apply it to a contribution.

## 5. Scheduled payout flow

### 5.1 Eligibility and scheduling

The scheduler may create a payout instruction only when all the following are true:

- The group is active and has a valid, verified, enabled payout account configuration.
- The payout is due according to the group's configured schedule and timezone.
- Every required contribution for the cycle has a provider-confirmed successful collection, with no unresolved reversal or reconciliation exception.
- The total net funds available for the cycle match the scheduled payout amount and provider fees/limits have been accounted for according to the disclosed group policy.
- The beneficiary is the member assigned to the payout slot and has a verified, current M-Pesa destination.
- No payout for that slot/cycle is already in progress or completed.

The scheduler must use a durable job/outbox record and a database uniqueness constraint so restart, concurrent workers, or retry cannot create duplicate payout instructions. Due dates are interpreted in the explicitly selected group timezone; use UTC for stored timestamps.

If any eligibility check fails, do not pay automatically. Leave the payout blocked with a reason, notify authorized group users, and require resolution before rescheduling.

### 5.2 Initiate and confirm a payout

1. The scheduler locks/claims the eligible payout instruction and records an internal idempotency key before making an external request.
2. The service sends the exact scheduled amount and verified beneficiary to the provider using the group's payout account.
3. The payout remains `pending` until provider confirmation establishes its final outcome. An accepted request is not proof that the beneficiary received funds.
4. On verified success, record the unique provider transaction ID and completion time, append balanced ledger entries and an audit event, mark the payout paid, then advance the cycle and create the next cycle's obligations atomically.
5. Notify the beneficiary and authorized group users with a receipt/reference that does not expose secrets or unnecessary personal data.

### 5.3 Payout failure and unknown outcome

- A definitive provider rejection leaves the payout unpaid and records the reason. Do not advance the cycle.
- A timeout or ambiguous response leaves it `pending`/`verification_required`. Query provider status or reconcile before retrying.
- A retry must use the same internal payout instruction and idempotency identity where supported. If the provider has no idempotency facility, verify the original outcome before another disbursement.
- A reversal after apparent success creates a compensating ledger transaction and a reconciliation exception; it does not delete the original payout.
- If the beneficiary details or group account change while a payout is pending, do not redirect or retry to the new destination without resolving the original attempt and recording an authorized change.
- A failed or blocked payout requires an operator-visible exception queue, clear reason, actor/action history, and a defined support/escalation process.

## 6. Transaction and ledger records

Keep payment attempts, provider events, contribution obligations, payout obligations, ledger postings, and audit events as separate concepts with explicit relationships. At minimum, a transaction record should capture:

- Internal transaction ID; transaction type (`collection`, `payout`, `refund`, `reversal`, or adjustment); group and related member/contribution/payout IDs.
- Amount as an integer in the currency's minor units (not a JavaScript floating-point amount); currency; direction; and applicable fees.
- Provider/environment and provider transaction/request references, with unique constraints where appropriate.
- Idempotency key, current state, state timestamps, and a safe failure/reconciliation reason.
- Initiating actor or scheduler identity, and recorded/updated timestamps.

Financial history must be append-only for confirmed movements. Corrections use linked compensating entries; do not edit or delete a confirmed financial posting to make balances appear correct. The ledger must balance, and balance/availability calculations must be derived from ledger entries and reconciled provider data rather than a client value.

Do not store M-Pesa PINs. Minimize and protect phone numbers and provider payloads; redact credentials, tokens, PINs, and unnecessary personal information from logs. Store only provider payload fields required for verification, support, and audit, with an explicit retention policy.

## 7. Reconciliation and operations

- Reconcile each group's ChamaFlow records against provider transaction queries/reports at least daily and after provider incidents.
- Match on provider transaction ID, account, amount, currency, and reference. Track unmatched, duplicate, under/overpayment, reversal, and missing-callback cases.
- Provide an authorized, auditable reconciliation queue. Manual resolution requires a reason and actor; it must not fabricate a provider success.
- Alert operators on callback failures, aged pending transactions, reconciliation mismatches, payout failures, and scheduler backlog.
- Keep secrets in a managed secret store, use TLS, restrict database and provider credentials by environment and least privilege, rotate credentials, and maintain tested backups and restore procedures.
- Use a shared rate-limit store if deploying multiple API instances. Use durable job processing and ensure the database pool, worker concurrency, and provider request limits are bounded.

## 8. User experience and support

Show understandable states: `Not started`, `Awaiting M-Pesa confirmation`, `Confirmed`, `Failed`, `Being verified`, and `Reversed`. State when the last update occurred and provide a safe reference for support.

Never show a contribution as paid or a payout as received based only on a client action. Make it clear that provider confirmation can be delayed and do not promise a fixed confirmation or refund time unless provider and operational evidence supports that service level.

Provide a support workflow for missing/duplicate charges, wrong amounts, delayed payouts, reversals, and changed phone numbers. Support staff should see sufficient audit evidence without being able to modify confirmed financial history.

## 9. Rollout and acceptance gates

### Phase 0: design and provider confirmation

- Confirm account ownership, provider products, API capabilities, callback security, payout limits, fees, reversals, and reporting.
- Finalize group rules, user consent, roles, beneficiary verification, dispute handling, support responsibilities, data retention, and legal/compliance review.
- Keep all current payment and payout screens in simulation mode.

### Phase 1: test environment

- Implement collection, callback verification, durable payment state, idempotency, ledger postings, payout scheduling, provider-status verification, and reconciliation.
- Test duplicate/replayed/out-of-order callbacks, timeouts, server restarts, concurrent requests, amount mismatches, provider outages, reversals, and scheduler retries.
- Add automated API/database tests and an end-to-end test environment using provider-approved test accounts.

### Phase 2: limited live pilot

- Enable live payments explicitly per group only after account verification, required approvals, operator training, monitoring, support readiness, and backup/restore checks.
- Start with one group and a controlled transaction limit. Reconcile every transaction and payout; have a clear pause/disable switch.
- Expand to additional groups only after the pilot's discrepancies, failure handling, and support load meet agreed thresholds.

### Go-live acceptance criteria

- No contribution or payout can be marked successful without verified provider evidence.
- Duplicate requests and callback replays cannot duplicate financial postings or payouts.
- Unknown outcomes remain pending and are reconciled before retry.
- Payouts cannot run unless every eligibility condition is met; a payout failure does not advance a cycle.
- Every financial state change is attributable and auditable, and every ledger posting balances.
- Provider reconciliation, monitoring, incident response, and support procedures have been exercised successfully.
- User-facing documentation accurately describes actual live behavior, fees, timing, risks, and support channels.
