# SAKHI

A personal safety network for everyday journeys. Phase 1 is being implemented in gated stages: foundation, trusted contacts/SOS, then Journey Guardian. It is not an emergency-services dispatch system.

**Current checkpoint (2026-10-10):** foundation, P0 contacts/SOS and P1 Journey Guardian are implemented and verified **locally with simulated notifications**. The Stage 2 safety map and nearby help are implemented and verified locally (public map services are unreliable and unverified in a real browser). Stage 3 area rooms, ratings, safety triage and moderation are implemented and verified locally. **Campus mode, offline messaging and the Cline Copilot are not built** (work was stopped after Stage 3 at the owner's request). Progress and evidence: `docs/PROJECT_JOURNEY.md`; open problems: `docs/KNOWN_ISSUES.md`; data provenance: `docs/DATA_SOURCES.md`; deployment blockers and advisories: `docs/SECURITY_AND_PRIVACY.md`. It is not an emergency-services dispatch system.

## Implemented P0 workflow

- Real persisted accounts and owner-scoped trusted-contact add/edit/delete, phone normalization and explicit sharing enablement.
- Dashboard SOS saves an event immediately, optionally obtains location with a 3-second fallback, and dispatches through a persisted, idempotent outbox.
- Alert detail/recent history with truthful per-recipient outcomes, no false delivery claims and a direct user-initiated 112 call action even during failures.
- Local simulation only; **no real SMS provider is integrated**. Production fails closed with notifications unavailable.
- Protected recovery/retry/retention job, runnable locally using `npm run jobs:once` or `npm run jobs:watch`. Production scheduling is not configured.

For a local test: sign up at `/auth`, add a trusted contact at `/contacts`, explicitly enable sharing, then activate SOS from `/dashboard`. The status must say **Simulated — no message sent**. Refresh to confirm persistence. Test without location or enabled contacts and verify that no success is reported and Call 112 remains available. Do not actually place emergency calls during testing.

## Implemented P1 workflow (Journey Guardian)

- `/journeys`: start a journey (destination, expected travel time, grace period, chosen sharing-enabled contacts), review exactly what will be shared, consent, then start. Check in, extend, complete or cancel. Optional, time-boxed location.
- The **server** moves a journey to "check-in needed" at the arrival time and to "escalated" after the grace period, then queues a notice to the selected contacts through the same outbox as SOS. This needs the protected job to run at least once a minute (`npm run jobs:watch` locally). The page shows a warning when the job has not run recently; **no production scheduler is configured or verified**.
- A notice goes to your contacts only. It never contacts the police; 112 and Women Helpline 181 are shown as user-dialled links.
- Not included: share links, push/SMS prompts to the user, continuous background tracking.

## Implemented Stage 2: nearby help and safety map

- `/services`: police, hospitals, ambulance stations, pharmacies, bus stops, washrooms, help points and verified Safe Havens near a chosen place, nearest first, with only the details that are mapped. 112 and 181 stay on screen.
- `/map`: Leaflet map, unverified reports and hazards (labelled), a prototype "reported-concerns" indicator that shows its inputs and limits (`docs/SAFETY_SIGNALS.md`), report form, and vehicle-route comparison with counts of nearby reports.
- Data comes from OpenStreetMap contributors via the public Overpass server (unreliable; cached; failures shown per category), SAKHI users' reports, and optional **synthetic demo data** (`npm run seed:demo`, off by default, labelled everywhere). No official crime statistics are connected. See `docs/DATA_SOURCES.md`.
- Optional live check of the map services: `npm run smoke:map`.

## Implemented Stage 3: area rooms, ratings, triage, moderation

- `/rooms`: a fixed ~500 m zone per area (same room for everyone inside it), live chat over Server-Sent Events with persisted history, pseudonyms, report/block/mute, and area ratings with reviews. Joining uses a self-reported position that isn't stored.
- Messages get a rule-based safety triage (`docs/SAFETY_TRIAGE.md`). It can only show the **sender** help options and queue a flag for **moderators**; it never contacts anyone and **misses about half of urgent messages** in measurement, so SOS and 112 stay on every page and are never gated on it.
- `/moderation` is for accounts granted the role with `npm run role:grant -- <email> moderator`. There is no moderator onboarding or coverage yet.

## Local development

Node.js 22.16+ and npm. From the repository root:

```powershell
npm ci
npm run setup
npm run db:migrate
npm run dev
```

Open http://localhost:3000. Register a real local account; authentication uses Better Auth and persisted SQLite sessions. No cloud credentials are required. Local notifications are simulated, not sent. Never use test workflows for an actual emergency; call 112 in India.

Configuration is in `.env.example`; `setup` creates random local secrets without overwriting an existing file. Secrets and database files are Git-ignored. SQLite requires a persistent local disk and single-host deployment, not ephemeral serverless storage. The app does not have a database RLS feature; all private access goes through ownership-scoped server services.

## Checks

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e`. Browser tests require `npx playwright install chromium`. See the documentation directory for acceptance evidence and deployment limitations as stages complete.

No SDK, AI-dependent emergency logic, public location directory, or automatic phone calling is included.
