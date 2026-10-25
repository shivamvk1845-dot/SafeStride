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
7. Run `npm test`, `npm run test --workspace=@safestride/web`, and `npm run build`.

The checked-in `.env.example` and `apps/api/.env.example` contain placeholders. For local use, copy the API example to `apps/api/.env`; keep its `DATABASE_URL` as `file:./dev.db`. The root example is for frontend build settings. Never use the example JWT secret in production.

Demo sign-in: `demo@safestride.example` / `SafeStrideDemo2026!`. Demo journeys are labeled and never send real notifications.
Do not run the demo seed command in production; it creates this known demo account.

## PostgreSQL

The PostgreSQL schema and migration history are separate from the SQLite development database. Do not apply `prisma/migrations` to PostgreSQL. For a local PostgreSQL service, install and start Docker Desktop, then run from the project root:

```powershell
docker compose up -d postgres
$env:DATABASE_URL = "postgresql://safestride:safestride_local@localhost:5432/safestride?schema=public"
npm run db:generate:postgres --workspace=@safestride/api
npm run db:migrate:postgres:dev --workspace=@safestride/api -- --name init
```

The initial PostgreSQL migration is in `apps/api/prisma/migrations-postgresql`. The default `db:generate` and `db:migrate` scripts continue to use SQLite. `DATABASE_URL` must point to the same PostgreSQL database for client generation and migration commands. The local Compose credentials are for localhost development only.

## Application features

- Server-side registration/login with salted bcrypt hashes, an HTTP-only session cookie (`SameSite=None; Secure` for the cross-origin production frontend), exact-origin credentialed CORS, input validation, rate limiting, secure headers, and owner-scoped APIs.
- Journey start, persisted check-ins and delays, safe arrival/cancellation, SOS event recording, optional GPS capture, recent journey history, and a last-known-position map using OpenStreetMap.
- Starting and destination addresses are resolved with the public OpenStreetMap Nominatim service, and route previews use the public OpenStreetMap routing service. These services require internet access, no API key, and are not guaranteed; lookup or routing failures are shown instead of drawing a fabricated route.
- Durable database-backed scheduled tasks for check-in reminders and grace-period escalation; the API worker polls tasks after startup and records unique notification attempts.
- Trusted contact selection, authorization on guardian views, expiring/revocable SHA-256-hashed share links, and minimum-data public share responses.
- Demo-only simulated check-in due, escalation, SOS, and arrival actions. Simulated events are identified as such and never contact emergency services.
- User profile, location-consent preference, contact management, and account deletion.

The current notification provider is intentionally `simulated` (or `in-app`) so local development and tests cannot send real messages. SMS transport is not activated by this starter; production SMS requires an explicitly configured provider adapter and credentials. No emergency call is ever made by the app. Notification records describe simulated attempts, not confirmed delivery.

## API overview

All routes are under `/api`. Private endpoints require the session cookie.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | API health |
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
| `API_PORT` | Local API port (default 4000); production uses Render's `PORT` |
| `PORT` | Supplied by Render in production |
| `WEB_ORIGIN` | Exact HTTPS frontend origin allowed by credentialed CORS (defaults in production to `https://safestride-web.onrender.com`) |
| `VITE_API_URL` | Public API origin used at frontend build time, without `/api` |
| `NOTIFICATION_PROVIDER` | Keep `simulated`; no real notification transport is implemented |

## Production deployment notes

### Render API web service

1. Create a managed PostgreSQL database and a Render Web Service connected to the GitHub repository. Use the repository root as the service root.
2. Configure the API build command:

   ```text
   npm ci --include=dev && npm run db:generate:postgres --workspace=@safestride/api && npm run build --workspace=@safestride/api && npm prune --omit=dev
   ```

3. Configure the pre-deploy command:

   ```text
   npm ci --include=dev && npm run db:migrate:postgres:deploy --workspace=@safestride/api
   ```

   This installs the Prisma CLI needed for migrations in Render's separate pre-deploy environment and applies only the PostgreSQL migration history. Do not run `migrate dev` in production.
4. Configure the start command:

   ```text
   npm run start --workspace=@safestride/api
   ```

5. Set Render's health-check path to `/api/health`. Set API environment variables in Render's dashboard: `DATABASE_URL` (the managed database's internal URL), `JWT_SECRET` (a newly generated secret of at least 32 characters), `WEB_ORIGIN=https://safestride-web.onrender.com` (the exact frontend HTTPS origin; this is also the production default), `NODE_ENV=production`, and `NOTIFICATION_PROVIDER=simulated`. Render supplies `PORT`; the API uses it in production.

### Render Static Site

1. Create a Static Site from the same repository, using the repository root as the service root.
2. Set the build command to:

   ```text
   npm ci --include=dev && npm run build --workspace=@safestride/web
   ```

3. Set the publish directory to `apps/web/dist`.
4. Set `VITE_API_URL` to the API's HTTPS origin (for example, `https://safestride-api.onrender.com`, without `/api`) in the Static Site's build environment, then trigger a fresh deploy. This variable is public and is embedded in the built frontend.
5. Set the API's `WEB_ORIGIN` to the Static Site's exact origin, including `https://` and no trailing path. Verify that the browser accepts the secure, `SameSite=Strict` session cookie for the chosen frontend/API hostnames.

Keep the API on one always-running instance: scheduled check-in processing currently runs as an in-process worker, so sleeping or multiple API instances can delay or duplicate work. Confirm database backups and restore procedures before storing production data. The `/api/health` endpoint checks that the API responds, not database readiness.

The PostgreSQL Prisma schema is `apps/api/prisma/schema.postgresql.prisma`, with its independent migrations in `apps/api/prisma/migrations-postgresql`. No SQLite data is automatically copied to PostgreSQL. Production registration and journey data will start empty unless you separately plan and verify a data import.

All SOS and escalation notifications remain simulated/in-app. The application does not send SMS or contact emergency services.
