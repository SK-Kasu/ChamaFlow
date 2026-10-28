# Database

ChamaFlow uses PostgreSQL.
The backend applies versioned migrations when it starts. Member records include registration numbers, telephone numbers, locations, and optional contact emails; a newly added member also receives a contribution record for the current cycle. The payment-ledger migration stores sandbox collection attempts, provider callback hashes, audit records, and immutable balanced ledger entries. It does not enable live payment processing or payout automation.
