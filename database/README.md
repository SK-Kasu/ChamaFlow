# Database

ChamaFlow uses PostgreSQL.
The backend applies versioned migrations when it starts. Member records include registration numbers, telephone numbers, locations, and optional contact emails; a newly added member also receives a contribution record for the current cycle. Membership requests are stored separately until an authorized group administrator links an applicant to an unclaimed roster entry. Email verification tokens are stored as hashes and expire after 24 hours. Existing accounts must verify their email before using authenticated endpoints.

The payment-ledger migration stores sandbox collection attempts, provider callback hashes, audit records, and immutable balanced ledger entries. It does not enable live payment processing or payout automation.
