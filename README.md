# ChamaFlow

A prototype workspace for Kenyan savings groups (chamas), built with React, Vite, Express, and PostgreSQL.

> **Prototype only:** Live M-Pesa collections and payouts are not enabled. Contribution STK Push is sandbox-only; payout records and the slot marketplace do not move money. Do not use this application to hold or manage real funds or sensitive production financial data.

## Features

- Chama dashboards for members, contribution progress, activity, and payout schedules.
- Contribution history and analytics, with demo recording and Daraja sandbox STK Push attempts.
- A sandbox payment ledger that records provider-verified test collections.
- Platform and SACCO administration tools for organizations, groups, administrators, and audit events.
- Sample-data demo mode when the API is unavailable.

Member participation profiles are based on recorded contribution history. They are not credit scores, lending decisions, or financial recommendations.

## Hosting and deployment

GitHub is suitable for hosting the source code and its history. It is not, by itself, a host for this full application:

- The backend is an Express API and needs a Node.js application host.
- The backend needs a PostgreSQL database.
- The frontend can be built as static files, but it must be configured to call the deployed API using the build-time `VITE_API_URL` setting. The backend's `FRONTEND_ORIGIN` must allow the deployed frontend origin.
- GitHub Pages serves static sites; it does not run the Express API or PostgreSQL. A project page would also need the correct Vite base path. Deploy the backend and database to separate hosting services.

Keep payment-provider credentials, database passwords, and JWT secrets out of the repository. If a secret was ever committed, revoke or rotate it; deleting the file in a later commit does not remove it from Git history.

## Requirements

- Node.js 22.12+ or 24 LTS. Vite 8 requires Node.js `^20.19.0 || >=22.12.0`; Node.js 20 is end-of-life, so use a supported LTS release.
- PostgreSQL 15 or later. PostgreSQL 14 is scheduled to reach end of support on November 12, 2026.

## Run locally

1. Create a PostgreSQL database named `chamaflow`.
2. Copy `backend/.env.example` to `backend/.env`. Set the local database connection values and set `JWT_SECRET` to a random value of at least 32 bytes. For example, generate one locally with `openssl rand -hex 32`.
3. Start the backend:

   ```sh
   cd backend
   npm ci
   npm run dev
   ```

4. In another terminal, start the frontend:

   ```sh
   cd Frontend
   npm ci
   npm run dev
   ```

5. Open <http://localhost:5173>. The API health endpoint is <http://localhost:5000/api/health>.

The backend applies versioned migrations on startup. The database user needs permission to create and modify the application tables.

### Daraja sandbox (optional)

Set the `MPESA_*` variables in `backend/.env` using sandbox credentials. `MPESA_CALLBACK_URL` must be an HTTPS URL reachable by the provider; local development may require a secure tunnel. The backend and database schema reject live payment mode. Do not use production credentials.

## Checks

Run backend tests:

```sh
cd backend
npm test
```

Build the frontend:

```sh
cd Frontend
npm ci
npm run build
```

## API overview

- `GET /api/health` — API/database readiness.
- `POST /api/auth/register` and `POST /api/auth/login` — account access.
- `/api/groups` — authenticated chama listing and creation.
- `/api/groups/:groupId/contributions` — contribution history and sandbox payment operations.
- `/api/admin` — administrator-scoped operations.

The Daraja callback endpoint does not trust callback data as confirmation; the backend queries the sandbox provider before recording a successful contribution. See [the payment flow specification](./docs/payment-flow-specification.md) for implementation limits and outstanding launch gates.

## Before production

Production financial use is not supported. Live collections, provider reconciliation operations, live disbursements, payout automation, group-specific provider account configuration, and several provider/compliance launch checks remain incomplete. Do not interpret a manual or sandbox ledger entry as evidence of a real payment.

## Reference sources

- [GitHub: About README files](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes) — purpose and common README content.
- [GitHub: Secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning) — exposed credentials and remediation.
- [GitHub Pages: What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) — static-site hosting scope.
- [Node.js release schedule](https://nodejs.org/en/about/previous-releases) — supported and end-of-life Node.js releases.
- [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/) — supported major versions and end-of-life dates.
- [Vite 8 package requirements](https://www.npmjs.com/package/vite) — Node.js engine requirement.

No `LICENSE` file is currently included. Add a license if you intend to grant others permission to use, modify, or redistribute this project.
