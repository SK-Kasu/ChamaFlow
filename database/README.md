# Database

ChamaFlow uses PostgreSQL.
The backend applies versioned migrations when it starts. The payment-ledger migration stores sandbox collection attempts, provider callback hashes, audit records, and immutable balanced ledger entries. It does not enable live payment processing or payout automation.
