# SAKHI

A personal safety network for everyday journeys. Phase 1 is being implemented in gated stages: foundation, trusted contacts/SOS, then Journey Guardian. It is not an emergency-services dispatch system.

**Current checkpoint:** foundation and P0 contacts/SOS are implemented. **P1 Journey Guardian has not been started**; this repository does not yet provide journey monitoring or missed-arrival escalation. The current checkpoint is being published at the user's request before proceeding to P1. See `docs/GATES.md` and `docs/TESTING.md` for executed checks, and `docs/SECURITY.md` for deployment blockers and known development-dependency advisories.

## Implemented P0 workflow

- Real persisted accounts and owner-scoped trusted-contact add/edit/delete, phone normalization and explicit sharing enablement.
- Dashboard SOS saves an event immediately, optionally obtains location with a 3-second fallback, and dispatches through a persisted, idempotent outbox.
- Alert detail/recent history with truthful per-recipient outcomes, no false delivery claims and a direct user-initiated 112 call action even during failures.
- Local simulation only; **no real SMS provider is integrated**. Production fails closed with notifications unavailable.
- Protected recovery/retry/retention job, runnable locally using `npm run jobs:once` or `npm run jobs:watch`. Production scheduling is not configured.

For a local test: sign up at `/auth`, add a trusted contact at `/contacts`, explicitly enable sharing, then activate SOS from `/dashboard`. The status must say **Simulated — no message sent**. Refresh to confirm persistence. Test without location or enabled contacts and verify that no success is reported and Call 112 remains available. Do not actually place emergency calls during testing.

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
