# SafeStride

**Live website:** [safestride-web.onrender.com](https://safestride-web.onrender.com/)

**API health:** [safestride-api.onrender.com/api/health](https://safestride-api.onrender.com/api/health)

SafeStride is a deployed journey-planning and check-in application designed to support women while travelling. It lets people plan a journey, record check-ins, and optionally share location information with trusted contacts. SafeStride is a support tool, not an emergency service.

## What the application does

- Create an account and sign in using a server-managed, HTTP-only session cookie.
- Plan journeys with start and destination addresses, travel details, an estimated arrival, check-in intervals, and an optional grace period.
- Record check-ins, delays, arrival, cancellation, and SOS events; view journey history and status.
- Add trusted contacts and select them for a journey. The application currently records check-in and escalation events but **does not send email, SMS, push notifications, or emergency calls**.
- Optionally share browser location with a journey. Location access requires browser permission and is not guaranteed while the page or browser is suspended or closed.
- Share a journey using a limited, expiring link, or view a journey through an authorized guardian route.
- Preview address locations and routes on a map using OpenStreetMap services. Address lookup and route requests require an internet connection and may fail.
- Use a clearly labeled, opt-in demo simulation for sample route progress and simulated journey events. Demo places are illustrative, unverified examples and are shown only in demo mode.

## Using the live application

1. Visit the [SafeStride website](https://safestride-web.onrender.com/).
2. Create an account or sign in.
3. Plan a journey and choose whether to enable location sharing. Add trusted contacts if useful; no messages are sent to them by this application.
4. Use the journey page to check in, report a delay, mark arrival, or record an SOS event.

If you are in immediate danger, contact your local emergency services directly. SafeStride does not dispatch help, monitor journeys continuously, or guarantee delivery of alerts. Browser GPS may stop when the page is suspended or closed.

## Technology and deployment

- **Frontend:** React, TypeScript, Vite, React Router, Leaflet, and OpenStreetMap tiles.
- **API:** Node.js, Express, TypeScript, Zod validation, bcrypt password hashing, HTTP-only cookie sessions, CORS, Helmet, and rate limiting.
- **Persistence:** Prisma with PostgreSQL for production and SQLite for local development and API tests. PostgreSQL has a separate Prisma schema and migration history.
- **Maps:** Leaflet with public OpenStreetMap tiles, Nominatim address lookup, and the public `routing.openstreetmap.de` routing service. These third-party services have their own availability and usage limits; no map API key is configured by this project.
- **Hosting:** The frontend is a Render Static Site; the API is a Render Web Service backed by managed PostgreSQL. The API runs the scheduled check-in worker in-process.

The frontend sends credentialed requests to the API origin configured at build time by `VITE_API_URL` (without `/api`). The API allows the exact web origin through credentialed CORS. Production sessions rely on the secure cross-origin HTTP-only cookie.

### Current limitations

- No email, SMS, push-notification provider, or emergency-service integration is implemented. Check-in and escalation records are not proof that a trusted contact was notified.
- The scheduled-task worker runs inside the API process. A sleeping service can delay processing, and multiple API instances can process work inconsistently; production should use one continuously running API instance unless the worker architecture is changed.
- Browser location requires explicit permission and an active page. Background GPS is not guaranteed when a browser or device suspends or closes the page.
- Map geocoding, routing, and tiles depend on public OpenStreetMap services and are not guaranteed to be available.
- Demo safe-place markers are illustrative only, are not verified or endorsed, and must not be used as emergency-service information.
- The health endpoint checks API availability; it does not confirm database readiness.

## Local Development

### Requirements

- Node.js 20 or newer and npm.
- SQLite is used by default for local development and automated API tests. Docker Desktop is only needed if you choose to run the optional local PostgreSQL service.

### Setup with SQLite

1. Install dependencies from the repository root:

   ```sh
   npm ci
   ```

2. Configure the API's local environment with `DATABASE_URL=file:./dev.db` and a local `JWT_SECRET`. Do not reuse development secrets in production.
3. Generate the SQLite Prisma client and apply the local migration:

   ```sh
   npm run db:generate
   npm run db:migrate -- --name init
   ```

4. Start the API and frontend:

   ```sh
   npm run dev
   ```

5. Open <http://localhost:5173>. The API health endpoint is <http://localhost:4000/api/health>. Register a local account through the app. `npm run db:seed` is an optional local-only demo seed; do not run it against production.
6. Run the checks:

   ```sh
   npm test
   npm run test --workspace=@safestride/web
   npm run build
   ```

### Optional local PostgreSQL

Production uses PostgreSQL; SQLite is the default for local development and tests. The PostgreSQL Prisma schema and migrations are separate from SQLite's. To run PostgreSQL locally with the repository's Compose service:

```sh
docker compose up -d postgres
```

Set `DATABASE_URL` to the local PostgreSQL connection string, then use the PostgreSQL-specific Prisma commands:

```sh
npm run db:generate:postgres --workspace=@safestride/api
npm run db:migrate:postgres:dev --workspace=@safestride/api -- --name init
```

Do not apply the SQLite migration history to PostgreSQL. No SQLite data is automatically copied to PostgreSQL.

### Environment variable reference

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite connection string for local development or PostgreSQL connection string for production. |
| `JWT_SECRET` | Session-signing secret; production requires at least 32 characters. |
| `API_PORT` | Local API port; defaults to `4000`. Render supplies `PORT` in production. |
| `PORT` | API listening port supplied by Render. |
| `WEB_ORIGIN` | Exact frontend origin allowed by credentialed API CORS. Production defaults to `https://safestride-web.onrender.com`. |
| `VITE_API_URL` | Frontend build-time API origin, without the `/api` path. |
| `NOTIFICATION_PROVIDER` | Must remain `simulated`; no external notification transport is implemented. |

### Render deployment architecture

The production deployment consists of a Render Static Site publishing `apps/web/dist`, a Render Web Service running `apps/api`, and a managed PostgreSQL database. For a new deployment, use the repository root as the service root and configure:

- **API build:** `npm ci --include=dev && npm run db:generate:postgres --workspace=@safestride/api && npm run build --workspace=@safestride/api && npm prune --omit=dev`
- **API pre-deploy migration:** `npm ci --include=dev && npm run db:migrate:postgres:deploy --workspace=@safestride/api`
- **API start:** `npm run start --workspace=@safestride/api`
- **API health check:** `/api/health`
- **Frontend build:** `npm ci --include=dev && npm run build --workspace=@safestride/web`
- **Frontend publish directory:** `apps/web/dist`

Configure production environment variables in the hosting provider's dashboard. Use the managed database URL, a newly generated `JWT_SECRET`, `NODE_ENV=production`, `WEB_ORIGIN` set to the exact frontend HTTPS origin, and `NOTIFICATION_PROVIDER=simulated`. Set `VITE_API_URL` to the API HTTPS origin in the frontend build environment and rebuild the static site when it changes. Keep secrets in the provider's secret settings, not in source control. Use the PostgreSQL-specific migration command for production; do not run `migrate dev` there.

## API overview

All API paths are under `/api`. Private endpoints require the session cookie.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | API health |
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Account and session |
| GET | `/api/auth/me`, PATCH/DELETE `/api/users/me` | Current profile and account |
| GET/POST | `/api/contacts` | List or add trusted contacts |
| DELETE | `/api/contacts/:id` | Remove an owned contact |
| GET/POST | `/api/journeys` | Journey history or start a journey |
| GET | `/api/journeys/active`, `/api/journeys/:id` | Active journey and details |
| POST | `/api/journeys/:id/check-in`, `/delay`, `/arrive`, `/cancel`, `/sos` | Journey actions |
| POST | `/api/journeys/:id/location` | Record a consented location |
| POST/DELETE | `/api/journeys/:id/share` | Create or revoke share links |
| GET | `/api/guardian/:id` | Authorized guardian journey view |
| GET | `/api/share/:token` | Limited, expiring share view |
| POST | `/api/demo/:id/:action`, `/api/demo/reset` | Demo-only simulation actions |
