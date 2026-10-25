# SafeStride

SafeStride is a journey check-in application with a server-managed safety session, optional location sharing, trusted contacts, and a visibly separated demo mode. It is a support tool, not an emergency service. A browser cannot guarantee GPS tracking when suspended or closed.

## Requirements

- Node.js 20 or newer and npm
- Docker Desktop only if using the optional PostgreSQL service

## Quick start (SQLite)

SQLite is the zero-setup development database. It is durable across server restarts and is used by the automated API tests. No SMS credentials or external services are required.

1. Install dependencies: `npm install`
2. Generate the Prisma client: `npm run db:generate`
3. Apply the local schema: `npm run db:migrate -- --name init`
4. Add a sample account and trusted contact: `npm run db:seed`
5. Start API and web app: `npm run dev`
6. Open <http://localhost:5173>. The API health check is <http://localhost:4000/api/health>.
7. Run `npm test` and `npm run build`.

The checked-in `.env.example` and `apps/api/.env.example` contain placeholders. For local use, copy the API example to `apps/api/.env`; keep its `DATABASE_URL` as `file:./dev.db`. The root example is for frontend build settings. Never use the example JWT secret in production.

Demo sign-in: `demo@safestride.example` / `SafeStrideDemo2026!`. Demo journeys are labeled and never send real notifications.

## PostgreSQL

For a local PostgreSQL service, install and start Docker Desktop, then run:

```powershell
docker compose up -d postgres
$env:DATABASE_URL = "postgresql://safestride:safestride_local@localhost:5432/safestride?schema=public"
npx prisma generate --schema apps/api/prisma/schema.postgresql.prisma
npx prisma migrate dev --schema apps/api/prisma/schema.postgresql.prisma --name init
```

Before launching the API against PostgreSQL, set `DATABASE_URL` to the same connection string and use the PostgreSQL-generated Prisma client. PostgreSQL is the intended deployment database; SQLite is for local evaluation. Do not expose the sample Compose credentials beyond localhost.

## Application features

- Server-side registration/login with salted bcrypt hashes, an HTTP-only SameSite session cookie, input validation, rate limiting, secure headers, and owner-scoped APIs.
- Journey start, persisted check-ins and delays, safe arrival/cancellation, SOS event recording, optional GPS capture, recent journey history, and a last-known-position map using OpenStreetMap.
- Durable database-backed scheduled tasks for check-in reminders and grace-period escalation; the API worker polls tasks after startup and records unique notification attempts.
- Trusted contact selection, authorization on guardian views, expiring/revocable SHA-256-hashed share links, and minimum-data public share responses.
- Demo-only simulated check-in due, escalation, SOS, and arrival actions. Simulated events are identified as such and never contact emergency services.
- User profile, location-consent preference, contact management, and account deletion.

The current notification provider is intentionally `simulated` (or `in-app`) so local development and tests cannot send real messages. SMS transport is not activated by this starter; production SMS requires an explicitly configured provider adapter and credentials. No emergency call is ever made by the app. Notification records describe simulated attempts, not confirmed delivery.

## API overview

All routes are under `/api`. Private endpoints require the session cookie.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | API health |
| POST | `/auth/register`, `/auth/login`, `/auth/logout` | Account and session |
| GET | `/auth/me`, PATCH/DELETE `/users/me` | Current profile and account |
| GET/POST | `/contacts` | List or add trusted contacts |
| DELETE | `/contacts/:id` | Remove an owned contact |
| GET/POST | `/journeys` | History or start a journey |
| GET | `/journeys/active`, `/journeys/:id` | Active journey and details |
| POST | `/journeys/:id/check-in`, `/delay`, `/arrive`, `/cancel`, `/sos` | Journey actions |
| POST | `/journeys/:id/location` | Record a consented location |
| POST/DELETE | `/journeys/:id/share` | Create or revoke share links |
| GET | `/guardian/:id` | Trusted-contact-only journey view |
| GET | `/share/:token` | Limited, expiring share view |
| POST | `/demo/:id/:action`, `/demo/reset` | Demo-only simulation actions |

Inputs are validated with Zod. The API returns JSON errors with appropriate HTTP status codes.

## Environment variables

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | SQLite URL for local work or PostgreSQL URL for deployment |
| `JWT_SECRET` | Random secret of at least 32 characters in production |
| `API_PORT` | API listen port (default 4000) |
| `WEB_ORIGIN` | Exact frontend origin allowed by CORS |
| `VITE_API_URL` | API base URL used by Vite |
| `NOTIFICATION_PROVIDER` | `simulated` in development |

## Production deployment notes

Build with `npm run build`; run the API with `npm --workspace apps/api start`; serve the `apps/web/dist` static assets from a frontend host and set `VITE_API_URL` at build time. Provision managed PostgreSQL with backups, TLS, restricted network access, and persistent storage. Set production secrets via the hosting provider, configure the exact `WEB_ORIGIN`, use HTTPS, run migrations during deployment, and run one API worker against the shared database.

The PostgreSQL Prisma schema is at `apps/api/prisma/schema.postgresql.prisma`. For a production release, generate the client and apply migrations with that schema. Keep database credentials and signing secrets out of source control. This starter does not include SMS transport, Socket.IO, a routing API, or verified safe-place data; those integrations must be implemented and tested before presenting them as available production capabilities.
