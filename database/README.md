# Database

ChamaFlow uses PostgreSQL. The live database is managed by the local PostgreSQL server and is not stored as project files here.

The backend applies versioned migrations when it starts. The payment-ledger migration stores sandbox collection attempts, provider callback hashes, audit records, and immutable balanced ledger entries. It does not enable live payment processing or payout automation.
