# Executed acceptance gates

## Foundation — passed 2026-10-10

- Repository cloned from supplied remote; empty repository, no existing app or changes to preserve. Nothing was committed or pushed during the foundation stage.
- npm install completed, random local secrets generated, real SQLite migrations applied.
- `npm test`: 50/50 unit, component and real Better Auth integration tests passed.
- `npm run typecheck`: passed. `npm run lint`: passed. `npm run build`: passed.
- `npm run test:e2e`: 4/4 Chromium desktop/mobile cases passed (landing/call action and real signup, refresh/session, logout/login).
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.
- Fixed migration export change, npm optional Windows binding omission, test typing errors and stricter cookie-less auth Origin enforcement. No failing tests removed.
- ESLint remains 9.39.5 because Next's included React/import/a11y plugins do not yet declare ESLint10 compatibility. npm flags9 as unsupported; track plugin upgrades.
- Only after these checks did contact implementation begin. Cloud SMS and hosted deployment have not been verified.

## Trusted contacts — passed before SOS implementation

- Full unit/component/API regression: 103/103 passing, including 32 contact service/API and21 contact UI cases.
- Contact browser tests:4/4 desktop/mobile, real authenticated CRUD, sharing opt-in/out, reload persistence and deletion cancellation/confirmation.
- Type check, lint and production build passed. Fixed effect loading-state lint finding without suppressing the rule.
- Explicitly forced Better Auth's built-in Origin/CSRF checks on in tests as well as production; fixture asserts the flags. No auth bypass is used.

## P0 local acceptance — passed 2026-10-10

- `npm test`: 202/202 unit, component, provider-double and real-auth/database API tests passed across seven files.
- Full Chromium browser regression: 16/16 passed on desktop/mobile (3.2 minutes). The final compact dashboard was then checked with two additional passing executions of the SOS location workflow, verifying the SOS button is completely visible before scrolling.
- `npm run typecheck`, `npm run lint`, and `npm run build`: passed on the publication checkpoint. An initial publication build reported an existing build lock; after confirming no build was still running, rerunning the unmodified build command succeeded. No check was disabled.
- Fixed transactional parent-alert reconciliation, a stale provider-result race, and an overly restrictive session-read quota. Regression coverage remains enabled. Earlier browser failures and their fixes are recorded in `TESTING.md`.
- Production dependency audit: 0 vulnerabilities. Full audit: 5 high-severity development-only entries in the Next ESLint dependency chain, documented in `SECURITY_AND_PRIVACY.md`; no incompatible downgrade was forced.
- Real SMS and production scheduling remain unconfigured/unverified. Simulation is explicitly labelled locally and refused in production. Passing this local gate does not imply real emergency delivery or production readiness.
- P1 Journey Guardian was not started before the user's request to publish all current changes. The next implementation stage is journey creation/management, followed by transactional ETA/check-in/escalation and its acceptance tests.

## P0 SOS + contacts acceptance — passed before P1

- `npm test`:202/202 passed (7files,39.98sec final run).
- Full Chromium desktop/mobile regression:16/16 passed (3.2min), then2/2 additional initial-viewport SOS checks passed after mobile layout refinement.
- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`:passed.
- Production audit0; full audit5high entries in development-only lint dependency chain, documented in SECURITY_AND_PRIVACY.md. No breaking downgrade or hidden audit suppression.
- Explicit simulation only. Production unconfigured provider safely fails. No external SMS credentials, delivery receipts or production scheduler verified.
- Fixed and regression-tested parent-summary crash reconciliation and read-only auth-session rate limit: original30/min caused429 in combined browser regression; read-only limit300/min remains enforced while credential limits remain strict.
- Source reviewed for owner checks and dispatch races. No configured local secret values found in generated static chunks. Minimal logs inspected; no sensitive payload logging added.
- Contact persistence, explicit consent, SOS independent of geolocation, ownership, idempotency, definite-failure retries, ambiguous outcomes, retained emergency calling and refresh persistence are verified.
- P1 work starts only after this recorded gate.

## Stage 0–1 (macOS) — P0 re-verified, P1 Journey Guardian — passed locally 2026-10-10

- Re-ran the whole baseline instead of trusting earlier results: `npm test` 202/202 (before P1 work). Fixed a platform lockfile problem (KI-001) and e2e auth rate-limit flakiness (Journey Entry 003; production limits unchanged and now covered by `tests/auth-limits.test.ts`).
- P1 gate: `npm test` **257/257** (adds 42 journey service/API tests, 10 component tests, 3 auth-limit tests); `npm run test:e2e` **22/22** (adds 3 journey cases on desktop and Pixel 7); `typecheck`, `lint`, `format:check`, `build` pass; `npm audit --omit=dev` 0.
- Race/guard tests were mutation-checked: weakening the escalation time guard, status guard and check-in-due ETA guard is detected.
- Still unverified: real SMS, production scheduler, share links (deferred), physical-device behaviour, account recovery. Evidence log: `docs/PROJECT_JOURNEY.md` Entries 001–012.
