# SAKHI

A personal safety network for everyday journeys in India: trusted-contact SOS, a Journey Guardian that notifies your contacts if you don't arrive, a safety map with nearby help, and moderated area chat rooms.

> **SAKHI is not an emergency service.** It never contacts the police or any emergency service on your behalf. Calling **112** (or Women Helpline **181**) is always a user-initiated action, and those links stay on screen even when something fails. Never use test workflows for a real emergency.

|                     |                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| **Status**          | Working prototype, verified **locally** with **simulated** notifications. Not production-ready.           |
| **Last checkpoint** | 2026-10-10, work stopped after Stage 3 at the owner's request                                             |
| **Stack**           | Next.js 16 (App Router) · React 19 · TypeScript · Better Auth · SQLite (`better-sqlite3`) · Leaflet · Zod |
| **Tests**           | 409 unit/component/integration tests (Vitest) · Playwright e2e on desktop and Pixel 7                     |

## Contents

- [What works, and what doesn't](#what-works-and-what-doesnt)
- [Features](#features)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Commands](#commands)
- [Architecture](#architecture)
- [API reference](#api-reference)
- [Data sources and demo data](#data-sources-and-demo-data)
- [Security and privacy](#security-and-privacy)
- [Testing](#testing)
- [Deployment](#deployment)
- [Known limitations](#known-limitations)
- [Documentation index](#documentation-index)

## What works, and what doesn't

| Area                                          | State                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Accounts, sessions                            | Working (Better Auth, email + password). Email verification and password recovery are **not** set up. |
| Trusted contacts, SOS                         | Working locally. Notifications are **simulated, no SMS is sent**. Production fails closed.            |
| Journey Guardian                              | Working locally. Needs the background job running at least once a minute.                             |
| Safety map, nearby services, reports          | Working. Depends on unreliable public services (Overpass, OSRM, OSM tiles).                           |
| Area rooms, ratings, triage, moderation       | Working locally. Triage **misses about half of urgent messages**; never rely on it.                   |
| Real SMS or any notification provider         | **Not built.**                                                                                        |
| Campus mode, offline messaging, Cline Copilot | **Not built.**                                                                                        |
| Official crime statistics                     | **Not connected.** Risk indicators use user reports and clearly labelled synthetic demo data.         |

Evidence for every claim above is in [`docs/PROJECT_JOURNEY.md`](docs/PROJECT_JOURNEY.md); open problems are in [`docs/KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md).

## Features

### SOS and trusted contacts (P0)

- Owner-scoped contacts: add, edit, delete, with phone normalisation (`libphonenumber-js`). A contact is only messaged after you **explicitly enable sharing** for them.
- The dashboard SOS saves the event immediately, optionally takes location (3-second fallback; SOS never waits on GPS), and dispatches through a persisted, idempotent **outbox**.
- The alert page shows a truthful per-recipient outcome (queued, simulated, failed, unknown). Ambiguous sends are never retried blindly, and a "Call 112" action is always available.
- The SOS control sits in the mobile bottom bar and opens a confirmation, so a stray tap can't raise an alert.

Local test: sign up at `/auth`, add a contact at `/contacts`, enable sharing, then trigger SOS from `/dashboard`. The status must read **Simulated: no message sent**. Also try with no location and with no enabled contacts: no success may be reported and Call 112 must remain.

### Journey Guardian and trip planner (P1)

- `/journeys`: plan a trip between two places, compare **safest / fastest / shortest** routes (a demo score built from area ratings and nearby help; not a prediction), then start a journey with a destination, expected arrival, grace period and chosen contacts. You review exactly what will be shared and consent before it starts.
- Check in, extend, complete or cancel. Location is optional and time-boxed.
- **Share live update**: sends your chosen contacts the destination, ETA, route summary and, if you allow it, your latest location. Idempotent, rate-limited, and only for a journey in progress.
- The **server** (not the browser) moves a journey to _check-in needed_ at the arrival time and to _escalated_ after the grace period, then queues a notice to your contacts through the same outbox as SOS. This requires the protected job to run (see [Background job](#background-job)). The page warns when the job hasn't run recently.
- Not included: push/SMS prompts to _you_ (a closed tab means no in-app prompt, only the eventual contact notice), continuous background tracking.

### Nearby help and safety map (Stage 2)

- `/services`: police, hospitals, ambulance stations, pharmacies, bus stops, washrooms, help points and verified Safe Havens near a chosen place, nearest first, showing only details that are actually mapped. 112 and 181 stay on screen.
- `/map`: Leaflet map with reports and hazards (labelled unverified), a prototype "reported-concerns" indicator that shows its inputs and limits ([`docs/SAFETY_SIGNALS.md`](docs/SAFETY_SIGNALS.md)), a report form, and vehicle route comparison with counts of nearby reports.
- Choose a place by device location (optional), a city centre, or by tapping the map. There is no place-name search yet.

### Area rooms, ratings, triage, moderation (Stage 3)

- `/rooms`: a fixed ~500 m grid cell per area (everyone inside it shares one room). Live chat over **Server-Sent Events** with persisted history, per-room **pseudonyms**, report / block / mute, and area ratings with reviews (one per user per area, ≥ 5 ratings before an average is shown, contact details rejected).
- Joining uses a **self-reported** position that is not stored.
- Messages get a rule-based safety **triage** (English, Hindi, romanised Hindi). It can only show the _sender_ help options and queue a flag for moderators. It never messages anyone, and SOS/112 are never gated on it. See [`docs/SAFETY_TRIAGE.md`](docs/SAFETY_TRIAGE.md) for measured quality.
- `/moderation`: queue for accounts holding the `moderator` role (shown as "not found" to everyone else). Hide messages/ratings, ban members, resolve reports and alerts.

## Quick start

**Requirements:** Node.js **22.16+** and npm. No cloud credentials are needed.

```bash
git clone https://github.com/a-kakade/Cline.git
cd Cline
npm ci
npm run setup        # creates .env.local with random secrets (never overwrites)
npm run db:migrate   # applies Better Auth + SQL migrations to ./data/sakhi.sqlite
npm run dev
```

Open <http://localhost:3000>, create an account at `/auth`, and you're in. Notifications are simulated; nothing is sent.

Optional extras:

```bash
npm run seed:demo                              # load labelled SYNTHETIC reports from the CSV
npm run role:grant -- you@example.org moderator   # make an account a moderator
npm run jobs:watch                             # run the background job every minute (second terminal)
```

### Background job

Journey escalation, SOS retries and data retention all run from one protected endpoint, `POST /api/internal/jobs`, authenticated with `JOB_SECRET`. Locally:

```bash
npm run jobs:once     # one run
npm run jobs:watch    # keep running (leave the terminal open)
```

Without it, journeys **will not escalate** and retention does not happen. No production scheduler is configured or verified.

## Configuration

Copy-free setup: `npm run setup` writes `.env.local`. All variables are documented in [`.env.example`](.env.example).

| Variable                | Required | Default                                          | Purpose                                                                    |
| ----------------------- | :------: | ------------------------------------------------ | -------------------------------------------------------------------------- |
| `BETTER_AUTH_URL`       |   yes    | `http://localhost:3000`                          | Public origin. Mutations require this exact `Origin`. HTTPS in production. |
| `BETTER_AUTH_SECRET`    |   yes    | generated                                        | ≥ 32 random characters. Also seeds room pseudonyms.                        |
| `JOB_SECRET`            |   yes    | generated                                        | ≥ 32 characters. Bearer token for `/api/internal/jobs`.                    |
| `DATABASE_PATH`         |    no    | `./data/sakhi.sqlite`                            | SQLite file. Needs a persistent local disk.                                |
| `NOTIFICATION_PROVIDER` |    no    | `simulation`                                     | `simulation` is refused in production; `disabled` fails closed.            |
| `EMERGENCY_NUMBER`      |    no    | `112`                                            | Number used by the "Call" action (digits, optional leading `+`).           |
| `OVERPASS_ENDPOINTS`    |    no    | public `overpass-api.de` + one mirror            | Comma-separated Overpass servers.                                          |
| `OVERPASS_USER_AGENT`   |    no    | built-in                                         | Identify your deployment to OSM services (their policy requires it).       |
| `OSRM_URL`              |    no    | `https://router.project-osrm.org`                | Routing server. The public demo returns **vehicle routes only**.           |
| `MAP_TILE_URL`          |    no    | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Tile server; its origin is added to the CSP `img-src`.                     |
| `ALLOW_DEMO_DATA`       |    no    | unset                                            | Set to `1` to show synthetic demo data in production.                      |

Secrets and database files are Git-ignored (`.env*`, `data/`, `*.sqlite*`).

## Commands

| Command                                                   | What it does                                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run dev`                                             | Start the dev server on port 3000                                                   |
| `npm run build` / `npm start`                             | Production build / serve                                                            |
| `npm run setup`                                           | Create `.env.local` with random secrets                                             |
| `npm run db:migrate`                                      | Apply migrations (Better Auth first, then `migrations/*.sql`, recorded in a ledger) |
| `npm run typecheck`                                       | `next typegen` + `tsc --noEmit`                                                     |
| `npm run lint` · `format:check`                           | ESLint · Prettier check (`npm run format` to fix)                                   |
| `npm test`                                                | Vitest: unit, component, real-auth/SQLite API tests                                 |
| `npm run test:e2e`                                        | Playwright against an isolated server and temp DB                                   |
| `npm run check`                                           | typecheck + lint + test + build                                                     |
| `npm run jobs:once` / `jobs:watch`                        | Call the protected background job once / every minute                               |
| `npm run seed:demo`                                       | Load synthetic demo reports (`-- path/to.csv`, `--no-rebase` optional)              |
| `npm run role:grant -- <email> moderator [grant\|revoke]` | Grant or revoke the moderator role (never possible over HTTP)                       |
| `npm run smoke:map`                                       | Live check of Overpass + OSRM through SAKHI's own adapters                          |
| `npx tsx scripts/triage-eval.ts <file.json>`              | Score the triage rules against a labelled set                                       |
| `npx tsx scripts/build-hotspots.ts` · `fetch-services.ts` | Regenerate `src/data/demo-hotspots.json` / `demo-services.json`                     |

## Architecture

One Next.js Node server with Better Auth and SQLite. No other backend.

```text
Browser ── pages / client components (src/app, src/components, src/lib)
   │
   ▼  fetch (same origin) / EventSource
Route handlers (src/app/api/**)    session check · Origin check · 16 KiB JSON cap · Zod validation
   │
   ▼
Domain services (src/server/**)    ownership-scoped, parameterised SQL, short synchronous transactions
   │                │
   ▼                ▼
SQLite (WAL)     Third parties: Overpass · OSRM · OSM tiles  (notification provider: simulation only)
```

```text
src/app/          pages and route handlers (App Router)
src/components/   UI (client components, CSS modules, Tailwind v4)
src/lib/          shared types, geo maths, schemas, client helpers
src/server/       server-only domain services (never imported by the client)
  places/         Overpass client, cache, nearby search
  triage/         rule-based message triage
src/data/         demo hotspot / services snapshots (see Known limitations)
migrations/       001–008 versioned SQL migrations
scripts/          setup, migrate, jobs, seed, roles, smoke and eval tools
tests/            Vitest suites, fixtures, Playwright specs (tests/e2e)
docs/             architecture, evidence, decisions (ADRs), known issues
```

Design decisions worth knowing:

- **SQLite has no row-level security**, so every private query is scoped by the authenticated user in the server layer. The client never supplies an owner id.
- **Transactional outbox** for SOS and journey notices: persist first, dispatch second, record each attempt. Provider calls are never awaited inside a DB transaction.
- **Server-driven state machines.** Journey transitions (`active → check_in_due → escalated`) happen in the job with guarded updates, not in the browser.
- **Realtime over SSE** with an in-process pub/sub bus ([ADR 0003](docs/decisions/0003-realtime-over-sse.md)), server `ping` events and a client watchdog. Correct on one Node process only.
- Timestamps are UTC integer milliseconds; formatting is a UI concern.

### Data model (SQLite)

| Migration | Tables                                                                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001       | `audit_events`, `request_limits` (plus Better Auth's `user`, `session`, `account`, `verification`)                                                              |
| 002       | `contacts`                                                                                                                                                      |
| 003       | `alerts`, `deliveries`, `delivery_attempts`                                                                                                                     |
| 004–005   | `journeys`, `journey_contacts`, `journey_events`, `job_heartbeats`                                                                                              |
| 006       | `places_cache`, `safe_havens`, `reports`, `report_requests`                                                                                                     |
| 007       | `user_roles`, `rooms`, `room_members`, `room_bans`, `messages`, `message_reports`, `user_blocks`, `ratings`, `rating_reports`, `triage_results`, `alert_events` |
| 008       | `journey_shares`, `journey_share_deliveries`                                                                                                                    |

## API reference

All endpoints except auth and the job endpoint require a signed-in session. Mutations also require the configured `Origin`. Errors use a generic JSON shape and never include stack traces or submitted values.

| Area       | Endpoints                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth       | `GET/POST /api/auth/*` (Better Auth)                                                                                                                                                                      |
| Contacts   | `GET/POST /api/contacts` · `PATCH/DELETE /api/contacts/:id`                                                                                                                                               |
| SOS        | `GET/POST /api/sos` · `GET /api/sos/:id` · `POST /api/sos/:id/dispatch`                                                                                                                                   |
| Journeys   | `GET/POST /api/journeys` · `GET /api/journeys/:id` · `POST /api/journeys/:id/:action` · `POST /api/journeys/:id/share` · `GET /api/journeys/monitor`                                                      |
| Trip       | `POST /api/trip/plan` · `POST /api/routes/compare`                                                                                                                                                        |
| Map        | `GET /api/places/nearby` · `GET /api/services/nearby` · `GET/POST /api/reports` · `GET /api/areas/summary`                                                                                                |
| Rooms      | `GET /api/rooms` · `POST /api/rooms/resolve` · `POST /api/rooms/join` · `GET/POST /api/rooms/:id/messages` · `GET /api/rooms/:id/stream` (SSE) · `POST /api/rooms/:id/leave` · `POST /api/rooms/:id/mute` |
| Safety     | `POST /api/messages/:id/report` · `POST /api/messages/:id/block` · `POST /api/blocks/unblock`                                                                                                             |
| Ratings    | `GET /api/areas/:id/ratings` · `PUT/DELETE /api/areas/:id/rating` · `POST /api/ratings/:id/report`                                                                                                        |
| Moderation | `GET /api/moderation/queue` · `POST /api/moderation/{messages/:id/hide, messages/:id/ban, ratings/:id/hide, reports/:id, alerts/:id}` (moderator role only)                                               |
| Internal   | `POST /api/internal/jobs` (Bearer `JOB_SECRET`)                                                                                                                                                           |

## Data sources and demo data

| Source                                                      | Used for                                  | Notes                                                                                                                         |
| ----------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| OpenStreetMap via Overpass (ODbL)                           | Police, hospitals, pharmacies, etc.       | Contributor-mapped, **not verified**. Public servers are flaky: cached 24 h with stale fallback, failures shown per category. |
| OSRM public demo                                            | Route geometry                            | **Vehicle routes only**; walking/bike profiles return identical results. Not for production.                                  |
| OSM tile server                                             | Map tiles                                 | Light use only; set `MAP_TILE_URL` for anything real.                                                                         |
| SAKHI user reports                                          | Reported-concerns indicator               | Unverified; positions rounded to ~110 m.                                                                                      |
| `Woman_Safety_Dataset_Management.csv` and `src/data/*.json` | Demo hotspots, ratings, chats, help desks | **Synthetic.** Labelled everywhere in the UI. Hidden in production unless `ALLOW_DEMO_DATA=1`.                                |
| NCRB / data.gov.in                                          | -                                         | Evaluated, **not connected** (licence and recency unclear).                                                                   |

Full provenance: [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md).

## Security and privacy

- Real sessions (httpOnly cookies, 7 days), minimum 12-character passwords, no test-login route or impersonation header.
- Server-side session check on every private route; exact-`Origin` check on writes; 16 KiB JSON bodies; parameterised SQL; auth library logging disabled; no request bodies, cookies or message text in logs.
- Headers: CSP (`connect-src 'self'`, `img-src` limited to the tile origin), `X-Frame-Options: DENY`, `no-referrer`, `nosniff`, HSTS, `Permissions-Policy` allowing only same-origin geolocation. The CSP still permits inline scripts (a nonce-based policy is future hardening).
- Rate limits on auth, SOS, shares, reports, and chat (e.g. 20 messages/min). Production auth limits (30/min) are covered by a regression test; the e2e override is ignored in production.
- Room messages and ratings expose only per-room HMAC pseudonyms: no user ids, emails or coordinates. Exact user position is never sent to Overpass (a ~1 km grid point is).
- **Retention** (by the background job): SOS coordinates 24 h, finished alerts 30 days, audit events 90 days, finished journeys 30 days, room messages 30 days, reports 2 years, places cache 7 days.
- Dependencies: `npm audit --omit=dev` reported 0 vulnerabilities at the last check. Five high-severity advisories sit in the **dev-only** ESLint chain and are documented, not hidden ([`docs/SECURITY_AND_PRIVACY.md`](docs/SECURITY_AND_PRIVACY.md)).

Release blockers before real use: a real notification provider with verified delivery, an independent monitored scheduler, HTTPS, encrypted persistent storage with tested backups, account recovery and verification, moderation staffing, incident response, and an external security review.

## Testing

```bash
npm test                                   # 409 tests, ~40 s
npx playwright install chromium            # one-time
npm run test:e2e                           # desktop + Pixel 7, isolated server and DB
npm run check                              # typecheck + lint + test + build
```

- Service and API tests run against **real Better Auth and migrated in-memory SQLite**, not mocks.
- E2E starts its own server on port 3000 (stop any dev server first) with local stand-ins for Overpass, OSRM and tiles, so browser tests never touch public services.
- Race and guard tests (escalation timing, membership checks, moderator checks) have been mutation-checked.
- CI ([`.github/workflows/verify.yml`](.github/workflows/verify.yml)) runs format check, typecheck, lint, tests, build and e2e on every push and PR.
- Triage quality is measured, not assumed: `npx tsx scripts/triage-eval.ts tests/fixtures/triage-eval-heldout2.json`.

More: [`docs/TESTING.md`](docs/TESTING.md) (note: its older sections are Windows-specific history, KI-002).

## Deployment

Not production-ready. If you deploy anyway:

- A **long-running Node host** with a **persistent, encrypted local volume**. Not serverless or an ephemeral filesystem, and not several hosts sharing one SQLite file.
- **Single instance only**: realtime rooms use in-process pub/sub and would silently split across instances.
- HTTPS, with `BETTER_AUTH_URL` set to the public origin.
- Run an external scheduler hitting `POST /api/internal/jobs` with `Authorization: Bearer $JOB_SECRET` **at least once a minute**, with failure alerting.
- Configure `NOTIFICATION_PROVIDER` only once a real adapter exists; until then production reports notifications as unavailable.
- Use your own tile server, Overpass instance and a walking-capable router.
- Moving to PostgreSQL needs a deliberate migration with equivalent ownership and locking tests, not a new connection string.

## Known limitations

The headline ones; the full register (KI-001 to KI-019) is in [`docs/KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md).

- **No real SMS** (KI-010). Delivery, receipts and acknowledgement are unverified.
- **Triage misses about half of urgent messages** (KI-016). It only flags; it is never a safeguard.
- **Room membership is self-reported** (KI-017) and there is **no moderator onboarding or coverage** (KI-018).
- **Realtime is single-host and not load-tested** (KI-019).
- Check-in prompts exist only in the open page (KI-012).
- Public Overpass/OSRM/tile servers are unreliable and unsuitable for production load (KI-007, KI-008, KI-013).
- No Safe Haven onboarding, so real installs show none (KI-014). No place-name search (KI-015).
- The provided CSV is synthetic (KI-006).
- The Cline SDK / Copilot is design-only ([`docs/CLINE_SDK_INTEGRATION.md`](docs/CLINE_SDK_INTEGRATION.md)); adding the SDK raised production audit advisories (KI-011).
- **Fresh-clone build caveat:** `src/data/*.json` are imported by the app but the `data/` rule in `.gitignore` also matches `src/data/`, so those files are currently untracked. A clean clone will not build until they are committed (e.g. change the rule to `/data/`) or regenerated with `scripts/build-hotspots.ts` and `scripts/fetch-services.ts`.

## Documentation index

| Doc                                                              | Contents                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                   | Foundation decision and deployment boundary                   |
| [`docs/PROJECT_JOURNEY.md`](docs/PROJECT_JOURNEY.md)             | Dated log of every stage, failure and fix, with evidence      |
| [`docs/GATES.md`](docs/GATES.md)                                 | Acceptance gate results                                       |
| [`docs/KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md)                   | Issue register with severity and status                       |
| [`docs/SECURITY_AND_PRIVACY.md`](docs/SECURITY_AND_PRIVACY.md)   | Controls, retention, third-party data flows, release blockers |
| [`docs/NOTIFICATIONS.md`](docs/NOTIFICATIONS.md)                 | Dispatch and delivery semantics                               |
| [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md)                   | Source registry, licences, verification status                |
| [`docs/SAFETY_SIGNALS.md`](docs/SAFETY_SIGNALS.md)               | How the reported-concerns indicator works and its limits      |
| [`docs/SAFETY_TRIAGE.md`](docs/SAFETY_TRIAGE.md)                 | Triage taxonomy, evaluation sets and measured quality         |
| [`docs/DATABASE.md`](docs/DATABASE.md)                           | Database notes                                                |
| [`docs/TESTING.md`](docs/TESTING.md)                             | Test strategy and historical evidence                         |
| [`docs/CLINE_SDK_INTEGRATION.md`](docs/CLINE_SDK_INTEGRATION.md) | Future AI boundary (design only)                              |
| [`docs/decisions/`](docs/decisions)                              | ADRs: stack, SDK boundary, realtime over SSE                  |

## License

No license file is present, so all rights are reserved by default. Add a `LICENSE` before accepting outside contributions. Map data © OpenStreetMap contributors (ODbL).
