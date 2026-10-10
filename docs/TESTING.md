# Test evidence and local verification

## Current commands (macOS/Linux, Node 22) — added 2026-10-10

```bash
npm ci && npm run setup && npm run db:migrate
npm run format:check && npm run typecheck && npm run lint
npm test                                   # Vitest: unit, component, real-auth/SQLite API tests
npx playwright install chromium && npm run test:e2e   # real server, isolated temp DB, desktop + Pixel 7
npm run build && npm audit --omit=dev
```

Last run (Stage 1, 2026-10-10, macOS arm64, Node 22.19.0): 257/257 unit, 22/22 e2e, build/lint/typecheck/format pass, production audit 0. Journey Guardian is covered by `tests/journeys.test.ts` (service, races, job, API), `tests/ui-journeys.test.tsx` and `tests/e2e/journeys.spec.ts`. The e2e server sets `AUTH_RATE_LIMIT_MAX` because the suite signs up users faster than production auth limits allow; that override is ignored in production (`tests/auth-limits.test.ts`). The sections below are the earlier Windows-era evidence, kept as history (KI-002).

## Scope and environment

Evidence below was collected on **2026-10-10**, Windows x64, Node.js **22.16.0**,
npm **11.5.2**. Stage results are historical snapshots, not a claim that unrun
future functionality is complete. Foundation, contacts, and SOS are separate
gates; this document records no Journey Guardian/P1 acceptance.

Run commands from the repository root:

```powershell
Set-Location 'C:\Users\Aditya\AppData\Local\Cline\sakhi'
```

Use `npm ci` for a clean dependency install, then `npm run setup` and
`npm run db:migrate` for an ordinary local developer database. Browser tests use
their own runner/database instead; stop any existing server on port 3000 first.
Install the Chromium browser with `node node_modules/@playwright/test/cli.js install chromium`.
Never point automated tests at a real user's database or a deployed instance.

## Isolation and what the tests prove

- API/service fixtures use real Better Auth and migrated in-memory SQLite.
  Better Auth migrations run before application migrations. In installed
  Better Auth **1.7.7**, the supported migration import is
  `better-auth/db/migration`, not `better-auth/db`.
- Each fixture uses a fresh random secret of at least 32 characters and
  `BETTER_AUTH_URL=http://localhost:3000`. Users and cookie-backed sessions are
  created by real signup requests, not inserted or fabricated.
- Foundation redirects only the `getAuth` factory to the isolated auth instance.
  Contacts API tests redirect only `getAuth` and `getDatabase`; route handlers,
  password hashing, session verification, ownership, validation, SQL, and
  response envelopes are real. Component tests separately use mocked client
  services and do not substitute for the real integration/browser coverage.
- Contacts persistence includes a real temporary file database closed and
  reopened after create, update, and delete. Throttle reset tests use the
  service's injected clock rather than sleeping.
- Playwright starts the actual Next development app on **port 3000** through
  the isolated E2E runner. It creates a fresh OS-temporary SQLite database and
  random secrets, runs all migrations, sets simulation mode, and refuses to
  reuse an existing server. Browser auth and contact endpoints are not mocked.
- Two Chromium projects exercise a 1440x900 desktop viewport and a Pixel 7
  mobile profile. Mobile emulation is not evidence of physical-device calling
  behavior. Emergency `tel:112` links are inspected but **never clicked**.
- Tests send no real notifications and make no actual emergency calls. A passing
  sharing-preference test proves only persisted preference state, not consent
  from the recipient, delivery, active monitoring, or dispatch.

## Foundation acceptance gate — passed

Final foundation gate: **50 unit/integration/component tests passed** and
**4 browser tests passed**. The lead ran the complete 50-test unit gate after the
origin fix; QA ran the browser gate and the targeted/static checks below.

Commands actually executed by QA:

| Command                                                                                                                                                                                               | Observed result                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node node_modules/vitest/vitest.mjs run tests/foundation.test.ts --reporter=verbose`                                                                                                                 | Initial execution: 23 passed, 1 failed; cross-origin signup exposed the test-environment origin bypass described below. The final 50-test aggregate rerun passed after the lead's auth fix.                                                                         |
| `node node_modules/@playwright/test/cli.js test`                                                                                                                                                      | Foundation-only browser snapshot: **4/4 passed**, 1.3 minutes. Desktop/mobile landing emergency-link visibility and overflow checks; real signup, persisted session, logout/revocation, protected-route redirect, wrong-password error focus, and successful login. |
| `node node_modules/typescript/bin/tsc --noEmit`                                                                                                                                                       | Passed after the migration import and UI test option corrections.                                                                                                                                                                                                   |
| `node node_modules/eslint/bin/eslint.js tests/foundation.test.ts tests/helpers.ts tests/e2e/foundation.spec.ts playwright.config.ts scripts/e2e-server.ts`                                            | Passed.                                                                                                                                                                                                                                                             |
| `node node_modules/prettier/bin/prettier.cjs --check tests/foundation.test.ts tests/helpers.ts tests/e2e/foundation.spec.ts playwright.config.ts scripts/e2e-server.ts docs/CLINE_SDK_INTEGRATION.md` | Passed.                                                                                                                                                                                                                                                             |
| `node node_modules/@playwright/test/cli.js test --list`                                                                                                                                               | Listed the four foundation browser cases; discovery alone is not an execution result.                                                                                                                                                                               |

Commands run by the lead for the completed foundation gate (reported in the
team handoff): `npm test` (**50 passed**), `npm run typecheck`, `npm run lint`,
and `npm run build` (**passed**), and
`npm audit --omit=dev --audit-level=high` (**0 vulnerabilities reported**).
Dependency audit results are a point-in-time package check, not a security audit
of the application.

A separate direct `node --import tsx --input-type=module` smoke run using the real
fixture reported signup **200**, session **200** with the same verified owner,
logout **200**, and a revoked session. The browser log was written locally to
`foundation-e2e.log` (ignored generated evidence); its final line is
`4 passed (1.3m)`. The launcher exited after the tests.

### Early failures and resolutions

1. The first Vitest attempt failed at startup because the Rolldown Windows
   native binding was missing; no tests ran in that attempt. The lead repaired
   the dependency setup. The manifest now explicitly includes the Windows x64
   Rolldown optional binding so this environment can load the test runner.
2. `getMigrations` was initially imported from `better-auth/db`, which does not
   export it in the installed version. The main migration script, fixture, and
   E2E runner were changed to the verified `better-auth/db/migration` export.
3. Two component-test calls used Testing Library's unsupported `exact` role
   option. The UI teammate corrected those calls; TypeScript then passed.
4. The signup UI advertised eight-character passwords while the backend
   required twelve. The UI minimum and help text were aligned to **12–128**.
5. The first real cross-origin signup test returned 200 rather than 403.
   Inspection found Better Auth defaults origin checks off in `NODE_ENV=test`.
   The lead added an application auth-before hook requiring the configured
   origin for network mutations. The test assertion stayed strict and the
   subsequent complete unit suite passed. During the contacts stage the lead
   also explicitly set `disableOriginCheck: false` and `disableCSRFCheck: false`;
   the foundation fixture now asserts that neither check is skipped.
6. Development React emitted CSP `eval()` warnings during the passing browser
   run. The lead made `unsafe-eval` development-only; production remains
   restricted. The historical browser log predates that adjustment and retains
   those warnings; it should not be described as warning-free.

### Tooling limitation

ESLint **9.39.5** emits an upstream deprecation/support warning. An ESLint 10
attempt encountered incompatible plugin peer ranges, so the lead retained
ESLint 9 rather than force incompatible peers. This is a documented tooling
compatibility limitation, not a reason to ignore lint failures. Re-evaluate the
upgrade when the complete Next/ESLint plugin chain supports it, and rerun lint,
typecheck, tests, and build. No SDK dependency was installed during these gates.

The lead's later full `npm audit` found **five high-severity development-only
findings** in the ESLint/Next lint-plugin glob dependency chain. Production-only
`npm audit --omit=dev --audit-level=high` reported zero findings. Do not describe
all dependencies as vulnerability-free. See `SECURITY_AND_PRIVACY.md` in this directory for
the advisory details and the decision not to force a breaking framework downgrade.

## Contacts stage — service/API evidence

QA executed:

```powershell
node node_modules/vitest/vitest.mjs run tests/contacts.test.ts --reporter=verbose
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js tests/contacts.test.ts tests/e2e/contacts.spec.ts
```

Observed result: **32/32 contacts service/API tests passed** (9.47 seconds),
with typecheck and targeted lint passing. Coverage includes CRUD, Indian and
international normalization, duplicate 409s, invalid/embedded numbers and input
limits, sharing defaults and toggles, foreign-owner reads/updates/deletes,
unauthenticated routes, ownership injection, CSRF, non-cacheable safe envelopes,
20-contact limits, 60-write throttling and reset, minimal audit records, and
SQLite reopen persistence.

After the explicit Better Auth security options were added, QA also ran
`node node_modules/vitest/vitest.mjs run tests/foundation.test.ts tests/contacts.test.ts`:
**56/56 passed** (13.38 seconds). The existing foundation migration test now
asserts that `skipOriginCheck` and `skipCSRFCheck` are both false. This rerun
includes the 24 foundation service/API tests and the 32 contacts tests, not
the separately owned component suites.

QA ran
`node node_modules/@playwright/test/cli.js test tests/e2e/contacts.spec.ts`:
**4/4 browser tests passed** (1.4 minutes), covering anonymous access gating and
real contact CRUD, refresh persistence, edit, explicit enable/disable, and delete
confirmation/cancellation in both viewports. Signup uses the real auth API to
establish the browser cookie; all contact mutations are performed through the UI.
`contacts-e2e.log` ends with `4 passed (1.4m)` and the launcher exited normally.
The lead owns the separate whole-project contacts acceptance checks.

## SOS/P0 stage — service, provider, and API evidence

QA executed after the backend landed:

```powershell
node node_modules/vitest/vitest.mjs run tests/sos.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js tests/sos.test.ts tests/e2e/sos.spec.ts
```

The initial SOS run passed **57/57 tests** (10.58 seconds). After adding recovery
job authentication and retention coverage, the run passed **60/60 tests**
(10.98 seconds). Typecheck and targeted ESLint passed after two test-only
inference corrections: literal provider environments and explicit string-valued
request-header records. No failing assertions were relaxed.

After the lead's crash-parent reconciliation fix, QA reran the same SOS command:
**62/62 passed** (11.18 seconds). Two regressions emulate durable terminal
delivery rows with a stale queued/sending alert parent and verify recovery
updates the parent summary without resending.

Coverage includes:

- Real-auth alert creation, explicit consent, UUID idempotency, alert/outbox
  persistence before location, enabled-recipient selection, no-contact failure,
  owner scoping and unauthenticated/CSRF/validation API rejection.
- Location bounds, nonfinite values, accuracy limits, capture freshness,
  future-time limits, boundary acceptance, no-location fallback, and timestamped
  map context only for the selected owner's enabled contacts.
- Persisted attempt records before provider invocation, concurrent duplicate
  creation/dispatch protection, immutable first-dispatch location, stable
  per-delivery idempotency keys, and partial recipient outcomes.
- Accepted versus delivered versus failed/unknown/simulated states; bounded
  provider timeout with `AbortSignal`; exceptions and invalid provider output
  treated as unknown; production simulation refusal and fail-closed unconfigured
  delivery. These provider outcomes use controlled external-provider doubles,
  not a real SMS service.
- Retryable failures only, 60-second retry timing and three-attempt maximum;
  no automatic resend for ambiguous or successful outcomes; 15-second abandoned
  creation recovery; 30-second sending-lease recovery; late provider results
  cannot overwrite a recovered unknown attempt or create false delivery audits.
- Database close/reopen recovery, job bearer authentication independent of a
  user's session, 24-hour precise-location clearing, 30-day terminal-alert
  deletion with cascading delivery history, and 90-day audit retention.

The lead corrected a late-result race found during inspection: a stale provider
completion must stop when the delivery compare-and-set updates zero rows,
otherwise attempt history/audits could claim delivery while the delivery itself
remains unknown. The regression test verifies delivery, attempt, and audit state.

QA ran `node node_modules/@playwright/test/cli.js test tests/e2e/sos.spec.ts`:
**6/6 real-flow browser tests passed** (1.8 minutes) across desktop and mobile.
They cover granted browser location with persisted coordinates and status after
refresh, explicitly denied browser permission with no-location fallback, and
persisted `NO_CONTACTS` failure. Auth, contacts, alerts, and dispatch are real;
the app's local simulation provider is the only delivery mechanism. Evidence is
in ignored local `sos-e2e.log`, ending `6 passed (1.8m)`.

A separately added browser fault-injection case intercepts only SOS-create POST
responses with synthetic HTTP 503. It checks no false success, retained emergency
calling, and the same idempotency key on retry. An initial attempt was interrupted
before the test body; the next execution failed both projects because an
unscoped `role=alert` locator also matched Next's route announcer. The selector
was corrected to scope to `main`, retaining the same no-success assertion.
The corrected outage case passed both projects in the first full P0 browser
regression. That run completed **15 passed / 1 failed** (3.3 minutes, exit 1):
all eight SOS cases passed, but the mobile foundation flow hit a session-read 429. Trace inspection confirmed three `GET /api/auth/get-session` 429 responses
while signup returned 200. The lead added a separate 300/minute session-read
quota for frequent hydration/shared NATs, preserving the stricter 30/minute base
limit and credential-endpoint controls. A real-auth fixture regression exercises
300 successful reads followed by a 429; QA ran
`node node_modules/vitest/vitest.mjs run tests/foundation.test.ts` and all **25
tests passed** (5.22 seconds). The complete browser rerun after this
production configuration fix passed **16/16** (3.2 minutes); the initial failure remains recorded
in `p0-browser-regression.log` rather than hidden by test delays or auth bypasses.
Final successful evidence is `p0-browser-final.log`, run with
`node node_modules/@playwright/test/cli.js test`. It includes four foundation,
four contacts, and eight SOS cases. The later compact-dashboard layout delta was
verified with `node node_modules/@playwright/test/cli.js test tests/e2e/sos.spec.ts --grep "real SOS records allowed"`:
**2/2 passed** (1.2 minutes), including initial-viewport SOS access (the whole button
visible before scrolling) and screenshots on desktop and mobile. This does not
claim that a visual assertion was present in the earlier 16-case run.
Browser simulation is never evidence that a real message was sent.

Separately, the UI teammate reported the actual command
`npx vitest run tests/ui-sos.test.tsx tests/location.test.ts`: **36/36 passed**
(23 SOS UI and 13 location tests; 5.81 seconds). This covers bounded fetch/body
timeouts, same-UUID retries, creation-before-location ordering, no automatic
GET-triggered dispatch, truthful status labels, and location unsupported,
denied/no-reprompt, never-callback timeout, invalid, and stale-coordinate cases.
These are component/helper tests with browser/network doubles, not additional
real-provider or full-browser delivery evidence.

The lead's full `npm test` after the session-read quota regression passed **202/202
tests** in seven files (39.98 seconds), verified in `p0-release-tests.log` with exit 0.
Full typecheck and lint also passed. Browser results and production builds are
tracked separately; these unit results do not substitute for them.

### Explicit limitations

- No real SMS provider, telecom delivery receipt, or emergency-services dispatch
  has been tested. Production intentionally fails closed when unconfigured.
- Concurrency tests overlap requests/provider awaits against SQLite; they do not
  establish performance or correctness across a multi-host deployment.
- Recovery is exercised by direct worker/job invocation. These tests do not
  prove that a production scheduler is installed or continuously running.
- Retention assertions verify application/database operations, not removal from
  filesystem backups, provider infrastructure, or externally retained logs.
- UI geolocation timeout/denial unit results above are separately attributed to
  the UI teammate rather than inferred from this API suite.
- No Journey Guardian/P1 tests or implementation were added by this stage.

## Repeatable verification commands

These are run instructions; only the evidence sections above assert observed
results for specific snapshots.

```powershell
npm run typecheck
npm run lint
npm test
npm run build
node node_modules/@playwright/test/cli.js test tests/e2e/foundation.spec.ts
node node_modules/@playwright/test/cli.js test tests/e2e/contacts.spec.ts
node node_modules/@playwright/test/cli.js test tests/e2e/sos.spec.ts
```

Do not run two Next builds/dev servers concurrently in the same workspace.
On Windows, a long browser run can be launched with `Start-Process cmd.exe`
and redirected to an ignored `.log` file; inspect the final result and process
exit instead of mistaking a tool timeout for a test result.
