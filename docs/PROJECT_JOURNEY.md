# SAKHI project journey

Authoritative, append-only engineering log. Statuses: `PLANNED`, `IN_PROGRESS`,
`PASSED`, `FAILED`, `PARTIALLY_VERIFIED`, `BLOCKED`, `DEFERRED`. A feature is
never `PASSED` because it renders or compiles; only executed acceptance tests
count. Sensitive values (keys, coordinates, personal data) are never recorded.
Timezone for all entries: IST (+05:30). Related: `KNOWN_ISSUES.md`,
`DATA_SOURCES.md`, `decisions/`.

---

## Technical assessment (Stage 0, 2026-10-10)

### Starting state of the repository

- Git: branch `main`, 3 commits (`Initial commit`, `Initial commit: sakhi app with contacts, emergency, and journeys`, merge). One untracked file: `Woman_Safety_Dataset_Management.csv` (20,000 rows, 2.9 MB).
- Stack (kept): Next.js 16.4 App Router, React 19, TypeScript strict, Better Auth 1.7.7 (email+password, database sessions), `better-sqlite3` (WAL), zod 4, libphonenumber-js, Vitest 5, Playwright 1.64, ESLint 9, Prettier. Node 22.19 locally; `engines.node >=22.16`.
- `node_modules` was absent; the committed lockfile could not be installed on macOS (see Entry 001).

### What worked at the start (re-verified, not trusted from docs)

| Area                                                                                         | Evidence from this session                        |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Trusted contacts CRUD + sharing flag                                                         | Part of 202 passing unit/integration tests        |
| SOS: persisted idempotent alert, outbox, bounded provider send, simulation adapter, 112 link | 202/202 unit; 16 e2e (after Entry 003)            |
| Production fail-closed notification provider                                                 | Unit tests                                        |
| Static checks                                                                                | `format:check`, `typecheck`, `lint`, `build` pass |

### Important failures and gaps found

- Lockfile not installable on macOS; Vitest cannot start (Entry 001).
- E2E suite hit Better Auth rate limiting on a faster machine (Entry 003).
- **P1 Journey Guardian is partial**: service + API routes + migration exist, but no UI, **no server-side overdue/grace/escalation processing** (`check_in_due` and `escalated` are never set), no job wiring, no share links, and **zero tests**. The `check-in` action currently requires a new ETA (conflated with `extend`). README claim "P1 not started" is out of date.
- No 181 Women Helpline information.
- No map, places, chat, ratings, triage, campus mode, offline transport or Copilot.
- Docs missing: journey log, known issues, data sources, decisions; `TESTING.md` is Windows-path specific.
- The untracked CSV is **synthetic** (Entry 004) and must not be presented as real crime data.

### Proposed implementation sequence

Stage 0 audit/spikes → 1 P0/P1 hardening → 2 map + nearby services + safe havens → 3 area chat/ratings/triage/alerts → 4 campus → 5 offline (native shell) → 6 Cline Copilot → 7 full regression. Detailed plan: see the approved plan (kept outside the repo) and ADRs in `decisions/`.

### Riskiest dependencies (ranked)

1. **P3 offline P2P** – needs native code and two physical devices; cannot be verified from a web app or this environment.
2. **Cline live model call** – needs `CLINE_API_KEY` (user will supply). Runtime and tool execution already proven offline (Entry 005).
3. **Public Overpass reliability** – returned 504 for 2 of 3 cities in a spike (Entry 006); needs caching, per-category queries, mirror fallback.
4. **Real SMS delivery** – no provider credentials; simulation only; cannot be verified.
5. **Production scheduler** for journey escalation – not configurable/verifiable locally.
6. **Real crime-statistics data** – NCRB is aggregate; must not be shown as street-level.

### Acceptance gates for next milestones

- Stage 1 gate: every item in the prompt's P0 and P1 gate lists has an executed test; re-run of all prior suites green.
- Stage 2 gate: map markers/filters come from real API responses; source/age/limitations visible; location optional; demo data labelled.
- Stage 3 gate: realtime delivery + authz + reconnect + no private-location leakage tested; triage/alert policy tests including unknown/low-confidence/provider-failure.
- Later gates as written in the master prompt.

The assessment proves nothing works by itself; evidence is in the entries below.

---

## Entries

### Entry 001 — Dependency install on macOS · FAILED → PASSED

- Time: 2026-10-10T16:34+05:30. Workstream: environment. Objective: install deps and reproduce baseline.
- Action: `npm ci`. Result: exit 1 `EUSAGE` — lockfile out of sync, missing `lightningcss-*` optional binaries (lockfile generated on Windows).
- Attempt 1: `npm install` (adds missing entries) → install OK, but `npm test` failed at startup: `Cannot find native binding` for `rolldown` (lockfile listed only `@rolldown/binding-win32-x64-msvc`).
- Root cause (confirmed): known npm optional-dependency lockfile bug (npm/cli#4828) on a lockfile produced on a different platform.
- Resolution: deleted `node_modules` and `package-lock.json`, ran `npm install` (lockfile is in git; original recoverable). Compared resolved versions: only 4 transitive packages changed (`balanced-match`, `brace-expansion`, `eslint-visitor-keys`, `minimatch` hoisting); no direct dependency changed. `npm ci --dry-run` now succeeds.
- Re-run: `npm test` → 202/202 passed. Files changed: `package-lock.json`. Status: PASSED.
- Remaining: `@rolldown/binding-win32-x64-msvc` stays in `optionalDependencies`; harmless.

### Entry 002 — Baseline static checks and unit tests · PASSED

- Time: 2026-10-10T16:39+05:30. Commands: `npm run format:check` (exit 1 first: 6 un-formatted P1 files → fixed with `prettier --write`, re-check pass), `npm run typecheck` pass, `npm run lint` pass, `npm test` **7 files, 202/202 passed**, `npm run build` pass.
- Note: these prove the P0/foundation state only; P1 has no tests.

### Entry 003 — E2E baseline failures from auth rate limiting · FAILED → PASSED

- Time: 2026-10-10T16:45–16:52+05:30. Command: `npm run test:e2e` (Chromium desktop + Pixel 7 profile).
- Run 1: 10 passed, **6 failed**; run 2: 6 failed (different mix); with only the general limit raised: 4 failed. Failure: test helper's `POST /api/auth/sign-up/email` `expect(ok).toBe(true)` was false. A single failing test run alone **passed**.
- Evidence: trace network log shows `429 Too Many Requests`.
- Root cause (confirmed): Better Auth rate limiter — general 30 req/min/IP and built-in special rule 3 req/10 s for `/sign-up*` and `/sign-in*`. This machine completes the suite in ~40 s (original Windows run: 3.2 min), so tests exceed the limits. Not a product defect; production limits are intentionally strict.
- Fix: `AUTH_RATE_LIMIT_MAX` override honoured **only when `NODE_ENV !== "production"`**, set only by `scripts/e2e-server.ts`; applies to the general limit and the `/sign-up/*` and `/sign-in/*` rules. Files: `src/server/auth.ts`, `scripts/e2e-server.ts`.
- Re-run: `npm run test:e2e` → **16 passed (37 s)**. `tsc` and `eslint` pass.
- Regression coverage: e2e suite itself; production-default behaviour covered by existing foundation tests (to be re-run in Stage 1 with an explicit production-limit assertion — tracked KI-003).

### Entry 004 — CSV dataset provenance check · PASSED (finding)

- Time: 2026-10-10T16:26+05:30. Action: profiled `Woman_Safety_Dataset_Management.csv` with a read-only script (aggregate counts only).
- Findings: 20,000 rows, 10 cities, near-uniform city counts (1,921–2,043) and crime types (1,929–2,047); `time_of_day` label is statistically independent of the hour in `incident_timestamp` (each label spreads ~evenly over all four 6-hour blocks); random UUID incident ids; timestamps span 2024-05 to 2026-05; no source/licence column.
- Conclusion (confirmed): synthetic/generated. Registered as `MOCK_OR_SYNTHETIC` in `DATA_SOURCES.md`. It may seed clearly labelled demo fixtures; it must never be shown as real incidents or used to claim a validated prediction. Left untracked pending the owner's decision (KI-006).

### Entry 005 — Cline SDK spike · PASSED (offline runtime) / live call BLOCKED on key

- Time: 2026-10-10T16:44+05:30. Commands: `npm view @cline/sdk` (0.0.92, `engines.node >=22`, licence Apache-2.0); `npm install --save-exact @cline/sdk@0.0.92`; ran a throw-away script (deleted afterwards) with a custom `createTool` tool and a stub `AgentModel` through the real `Agent` runtime.
- Result: `status: completed`, 2 iterations, the tool executed, `outputText` = stub final text.
- Verified API facts against the installed package (not docs): `Agent`, `createTool` exported from `@cline/sdk`; `createTool` takes a zod schema in `inputSchema`; `Agent.run()` returns `AgentRunResult` with **`outputText`** (the SDK README's `result.text` is wrong for 0.0.92); `Agent.subscribe()` for events, `abort()` for cancel; config accepts either `providerId/modelId/apiKey` or a pre-built `model` (used for deterministic stubs in tests).
- Not verified: any live provider call (no key yet). Status: PARTIALLY_VERIFIED. Registry: `DATA_SOURCES.md` → Cline SDK.
- Open: confirm the SDK adds no built-in tools by default when only custom tools are passed (Stage 6 test), and review its dependency footprint (many OpenTelemetry/ws packages; telemetry opt-out to be checked).

### Entry 006 — OSM service spikes · PARTIALLY_VERIFIED

- Time: 2026-10-10T16:52+05:30. Method: read-only live HTTP queries with an identifying User-Agent, spaced ≥3 s apart.
- Overpass (`overpass-api.de`): Delhi centre combined query (police/hospital/pharmacy within 2 km + bus stops within 1 km) → HTTP 200 in 11.3 s: 42 elements (32 bus stops, 6 police, 4 hospitals, 0 pharmacies matched in this query); only 3/42 had a phone tag, 0/42 `opening_hours`. Same combined query for Bengaluru and Jaipur → **HTTP 504** after ~9 s. Smaller police+hospital-only Bengaluru query → 200 in 1.6 s (58 elements); mirror `overpass.private.coffee` also 200 (5.1 s); `overpass.kumi.systems` → 500.
- OSRM public demo (`router.project-osrm.org`): route + alternative returned `Ok` (2 routes) in 1.6 s. The public demo is not for production load; the foot-profile behaviour is not yet verified (KI-008).
- Nominatim public: search returned 200. Usage policy (1 req/s, identifying UA, no heavy use) applies.
- Design consequences: per-category small queries, server-side cache with TTL and stale marker, 10 s timeout + one mirror fallback, honest "missing" for absent phone/hours, never infer. No adapter written yet; sources are `EVALUATED_NOT_CONNECTED`.

### Entry 007 — Documentation scaffolding · PASSED

- Created this journal, `KNOWN_ISSUES.md`, `DATA_SOURCES.md`, `decisions/`; renamed `docs/SECURITY.md` → `docs/SECURITY_AND_PRIVACY.md` (git rename) and fixed references in README/GATES/TESTING.
- Next exact action was Stage 1 (Entries 008–012).

### Entry 008 — P1 Journey Guardian: state machine, scheduler processing, escalation · PASSED (local, simulated notifications)

- Time: 2026-10-10T17:00–17:10+05:30. Objective: close the P1 gaps found in the assessment (KI-005).
- Implemented: `src/lib/journey-state.ts` (single state machine, pure); migration `005_journey_guardian.sql` (`check_in_due_at`, `last_check_in_at`, `time_zone`, `all_clear_alert_id`, `alerts.kind`, `job_heartbeats`); `JourneyService` rewrite with `processOverdue()` (active → check_in_due at ETA; check_in_due → escalated at ETA+grace), per-journey immediate transactions, conditional `UPDATE … WHERE status/ETA` guards, idempotent escalation key `journey-escalation:<id>`, escalation reuses the P0 outbox via new `EmergencyService.createQueuedEvent`; all-clear/follow-up notice when an escalated journey is later completed/cancelled; coordinates cleared when a journey ends; retention for finished journeys (30 days); check-in semantics fixed (confirm safety; a new ETA is required only when answering a due check-in; optional fresh location); job route runs `processOverdue()` then `processPending()` and records a heartbeat; `GET /api/journeys/monitor` exposes whether the job has run recently.
- Files: `src/lib/journey-state.ts`, `src/lib/journey-types.ts`, `src/lib/alert-labels.ts`, `src/server/journeys.ts`, `src/server/emergency.ts`, `src/server/heartbeat.ts`, `src/server/retention.ts`, `src/server/services.ts`, `src/app/api/journeys/**`, `src/app/api/internal/jobs/route.ts`, `migrations/005_journey_guardian.sql`.
- Tests added: `tests/journeys.test.ts` (42), covering creation/persistence/refresh, validation, idempotency, one-open-journey, check-in/extend/complete/cancel, ETA extension preventing old-ETA escalation, grace periods, scheduler-down catch-up, retry after mid-escalation failure (rolled back, retried once), one failing journey not blocking others, stale-snapshot races, completion-vs-escalation ordering, duplicate/racing actions, provider failure shown truthfully, no-contacts escalation recorded as failed, all-clear sent once, rate limit, retention, audit trail content, HTTP authz (401/403/404), job route + provider, monitor route.
- Mutation check (confirmed by experiment): deliberately weakening the escalation time guard, the escalation status guard and the check-in-due ETA guard each initially went **undetected** (3 gaps found); I added tests for them and re-ran the mutations — each is now caught. Original code restored and verified identical.
- Result: `npx vitest run tests/journeys.test.ts` → 42 passed.
- Limitations: simulation provider only; no real SMS; check-in prompts exist only in the open page (no push/SMS to the user); escalation depends on an externally scheduled job (heartbeat shows whether it runs); share links NOT implemented (DEFERRED, not required for P1 gate); a SQLite single-host assumption (immediate transactions serialise writers on one host).

### Entry 009 — P1 UI, 181 helpline, component + browser tests · PASSED (local)

- Time: 2026-10-10T17:05–17:12+05:30. Added `/journeys` page, `JourneyGuardian` component (start form → "review what will be shared" → explicit consent → start; active, check-in-due and escalated views; scheduler warning banner; optional time-boxed location; idempotent retry), `EmergencyHelp` strip (112 and Women Helpline 181 as user-initiated `tel:` links), dashboard link; alert kind labels in SOS status/recent list.
- 181 verification: official Mission Shakti page (https://missionshakti.wcd.gov.in/, fetched 2026-10-10) lists "WHL : 181" and describes a 24x7 telephone short code service linking women to police, One Stop Centres and hospitals; it also lists 112 for emergencies. `https://112.gov.in/about` refused the connection from this machine (ECONNREFUSED) so 112's own description is unverified from here.
- Bug found by my own test: "ago" ages were rounded up (20 min displayed as 21); fixed (ages floor, countdowns ceil).
- Tests: `tests/ui-journeys.test.tsx` (10), `tests/e2e/journeys.spec.ts` (3 cases × desktop and Pixel 7) — real account, real server: review/consent gating, start, reload persistence, check-in, extend (+event order asserted), complete, 409 on second journey, cancel confirmation, 112/181 links visible, scheduler warning visible. Result: all pass.
- Note: e2e does not wait for a real deadline to pass; time-based escalation is proven at the service/job-route level with an injected clock.

### Entry 010 — Auth rate-limit regression test (KI-003) · PASSED

- `tests/auth-limits.test.ts` (3): defaults are 30/min and no sign-in/up override; `AUTH_RATE_LIMIT_MAX` is ignored when `NODE_ENV=production`; honoured only outside production and never below 30. KI-003 resolved.

### Entry 011 — Cline SDK production-audit finding · FAILED → resolved by deferral

- Time: 2026-10-10T17:12+05:30. After `npm install @cline/sdk@0.0.92`, `npm audit --omit=dev` reported **34 vulnerabilities (5 low, 11 moderate, 14 high, 4 critical)** — previously 0. Critical ones trace to `simple-git`/`@simple-git/argv-parser`; highs to SAP AI SDK packages, `node-forge`, `undici`/`@fastify/busboy`, all transitive dependencies of `@cline/core`/`@cline/llms`. SAKHI would use only `Agent` and `createTool`; those vulnerable code paths are not called, but they would ship in the deployment.
- Root cause: confirmed — transitive dependencies of the SDK (not SAKHI code). Reachability of each advisory is unassessed.
- Action: SDK uninstalled (it was unused); `npm audit --omit=dev` → 0 vulnerabilities again; `package.json` back to original dependencies. Logged as KI-011. Stage 6 must re-install, review reachability, consider npm `overrides`/bundling only the needed packages, and record the decision in an ADR before shipping.

### Entry 012 — Stage 1 regression gate · PASSED (local, simulated notifications)

- Commands (2026-10-10 ~17:13 IST): `npm run format:check` pass (after formatting new docs), `npm run typecheck` pass, `npm run lint` pass (0 warnings), `npm test` **10 files, 257/257 passed**, `npm run build` pass (new routes `/journeys`, `/api/journeys/monitor` listed), `npm run test:e2e` **22/22 passed** (Chromium desktop + Pixel 7), `npm audit --omit=dev` **0 vulnerabilities**.
- Not verified / not claimed: real SMS delivery; production scheduling; behaviour on a physical phone; account recovery; `112.gov.in` content. P0 and P1 are `PASSED` for local, simulated operation only — not production-ready.
- Next exact action: Stage 2 — verify NCRB/data.gov.in dataset availability and licence; design `places` service (per-category Overpass queries, cache, mirror fallback) test-first; then map UI.

### Entry 013 — Stage 2 data discovery · PARTIALLY_VERIFIED

- Time: 2026-10-10 ~17:14+05:30. NCRB / data.gov.in: web search found only old (2013, 2016) annual district-level crimes-against-women resources with no stated licence on the pages seen; the NCRB organisation page returned HTTP 403 to automated fetch; third-party repackagers exist with separate terms. **Decision: no official statistics feed is connected**; UI states "not available". Registered `EVALUATED_NOT_CONNECTED`.
- OSRM profile test (confirmed): `foot`, `driving` and `bike` return identical routes (3981 m/396 s; 5572 m/562 s) on the public demo, so only a vehicle network exists. Routes are labelled "vehicle road routes" (KI-008).
- Real Overpass recording: central-Delhi police/hospital sample showed `amenity=police` entries that are checkpoints, a "hospital" that is an IT firm, 2/7 phones, 0/7 hours. This drove the "mapped by contributors, not verified" labelling and the "Not mapped" convention. Fixture: `tests/fixtures/overpass-delhi-police-hospital.json` (ODbL).
- Public Overpass returned HTTP 504 repeatedly while recording the fixture (first attempt and mirror both failed; a smaller radius succeeded) — more evidence for per-category queries, caching and honest failure states.

### Entry 014 — Stage 2 backend: places, reports, area indicator, routes · PASSED (unit/integration)

- Implemented: `src/lib/geo.ts` (haversine, bbox, polyline distance, stable 500 m area grid), `src/lib/places-types.ts`, `src/server/places/{overpass,service}.ts`, `src/server/{reports,area-safety,routing,query,demo-seed,heartbeat}.ts`, migration `006_places_map.sql` (`places_cache`, `safe_havens`, `reports`, `report_requests`), API: `GET /api/places/nearby`, `GET|POST /api/reports`, `GET /api/areas/summary`, `POST /api/routes/compare`, retention for cache/old reports, `.env.example` entries, `npm run seed:demo`, `npm run smoke:map`.
- Privacy by design: the user's exact position is never sent to Overpass (a ~1 km grid point plus margin is); report positions stored rounded to ~110 m; reporter id never returned; route endpoints sent to OSRM only on explicit request and disclosed.
- Tests: `tests/geo.test.ts` (6), `tests/places.test.ts` (25), `tests/safety-map.test.ts` (21), `tests/demo-seed.test.ts` (5). Mutation checks (confirmed): sending the exact position upstream and removing the demo gate are each caught by a test.
- Bugs found and fixed on the way: whitespace left after stripping control characters in place names (parser); my own test used the wrong metres-per-degree constant; a rate-limit loop was off by one; a route test mis-expected a Safe Haven near a shared start point.

### Entry 015 — Stage 2 UI and browser tests · PASSED (local, stubbed third parties)

- Implemented `/services` (nearby help, no map payload) and `/map` (Leaflet, report layer, area panel with the indicator model shown, report form, route comparison), `LocationPicker` (device location optional; city centres; tap-the-map), `NearbyServices`, `EmergencyHelp` on both pages, dashboard links.
- E2E runner now starts local stand-ins for Overpass (recorded real response + one clearly named test pharmacy; requests near Patna return 504), OSRM (two fixed routes) and tiles, plus 3 labelled synthetic demo rows, so browser tests never use public servers.
- Bugs found by e2e: **(1) the client posted the picker object (`source`, `label`) to a strict route schema → "Unrecognized keys"**; fixed in `compareRoutes` + unit regression test. **(2)** on a phone the map was far above the "set destination" button; the page now scrolls the map into view when picking starts. Test-side: shared-DB report counts across browser projects, cached-vs-fresh source wording, ambiguous locators.
- Results: `tests/ui-map.test.tsx` (12), `tests/e2e/map.spec.ts` (5 cases × desktop and Pixel 7), run twice consecutively 10/10.

### Entry 016 — Live adapter smoke test · PASSED with caveats

- `npm run smoke:map` (2026-10-10, real Overpass + OSRM through SAKHI adapters): Delhi police 6 (hospital, pharmacy queries failed HTTP 5xx), Bengaluru police 10 + pharmacy 10 (hospital failed), Jaipur police 2 + hospital 10 (pharmacy failed), OSRM 2 routes. Roughly a third of category queries failed on the public server and were reported per category. One real OSM tile fetched with curl: HTTP 200 PNG. Registry updated: Overpass and OSRM `CONNECTED_VERIFIED` (with caveats), tiles `CONNECTED_UNVERIFIED` (KI-013).

### Entry 017 — Stage 2 regression gate · PASSED (local)

- 2026-10-10 17:39 IST: `format:check`, `typecheck`, `lint` pass; `npm test` **15 files, 326/326**; `npm run build` pass (new routes `/map`, `/services`, 4 APIs); `npm run test:e2e` **32/32**; `npm audit --omit=dev` 0 (Leaflet 1.9.4 added, no advisories).
- Not claimed: real-browser OSM tile rendering, any Safe Haven in real use (no onboarding workflow, KI-014), place search (KI-015), walking routes, official statistics, validated risk. Documentation of signals/limits: `docs/SAFETY_SIGNALS.md`.
- Next exact action: Stage 3 — design `rooms/messages/ratings/triage/alerts` migration; implement room assignment from the area grid, message service + SSE with authz, then ratings, triage taxonomy and alert policy, test-first.

### Entry 018 — Stage 3 backend: rooms, messages, ratings, moderation, alert policy · PASSED (unit/integration)

- Time: 2026-10-10 17:40–18:10+05:30. Migration `007_rooms_ratings_triage.sql` (roles, rooms, members, bans, messages, reports, blocks, ratings, rating reports, triage results, alert events). Services: `rooms.ts` (deterministic grid rooms, self-reported membership not storing the position, pseudonymous per-room aliases, validated/rate-limited/idempotent posting, cursor history, replay, block/mute/report), `room-bus.ts`, `room-stream.ts` (SSE), `alert-policy.ts`, `moderation.ts`, `ratings.ts` (one per user/area, 5-rating minimum before an average, day/night split, contact details rejected), `scripts/grant-role.ts`. 15 new API routes. Messages deleted after 30 days.
- Tests: `tests/rooms.test.ts` (33), `tests/room-stream.test.ts` (13), `tests/triage.test.ts` (11). Mutation checks (each confirmed to apply): disabling the membership check (4 tests fail), the moderator check, author alert cooldown, blocked-author filtering in history, and in the stream: blocked filter, revocation handling, heartbeat re-check, replay — all caught. Two earlier "surviving" mutations were no-ops (Prettier had reformatted the target lines); I re-ran them with formatting-tolerant patterns before trusting them.
- Test-side fixes: Better Auth's real 3-signups/10 s limit (used the non-production override), an off-by-one burst count, and a rolling-hour cap test that spaced posts too far apart.

### Entry 019 — Safety triage and its measured quality · PARTIALLY_VERIFIED (weak by measurement)

- Built a deterministic rules + lexical co-occurrence triage (EN, Hindi, romanized Hindi) and three labelled sets. First held-out run **60.3%, urgent recall 5/12**, all misses silently `general`. I revised the rules using that set's errors (so it is contaminated), then wrote a fresh set (held-out-2) and ran it once: **72.1% exact, urgent recall 6/12 (50%)**, distress 4/8. Rules not tuned on held-out-2.
- Conclusions recorded in `docs/SAFETY_TRIAGE.md` and KI-016: triage may only flag to moderators and offer sender-only help chips; SOS/112 are never gated on it; UI states suggestions may be wrong; the moderator note says flags miss real emergencies. Annotation is single-annotator. IndicSentiment/HASOC cards fetched: no licence stated, not emergency labels — not used.
- Status: the feature works as designed; its detection quality is **not adequate for relying on**.

### Entry 020 — Stage 3 UI and browser tests · PASSED (local)

- `/rooms` (location picker → resolve → join with consent → chat, ratings), `/moderation` (404 UI for non-moderators), `RoomChat` (history paging, empty/loading/error states, retry-safe send, block/report, sender-only help chips, honest connection status), `AreaRatings`, `ModerationQueue`.
- Real bug found by e2e: the browser never noticed a dead connection when offline (EventSource doesn't expose keep-alive comments). Fixed with server `ping` events, a 45 s client watchdog, `offline`/`online` handling and reconnect-by-history (which also detects removal from the room); unit test updated.
- E2E (`tests/e2e/rooms.spec.ts`, 6 cases × desktop + Pixel 7, run twice 12/12): two members chat live and see only pseudonyms; an outsider gets 403 on read/post/stream; offline → "reconnecting" → missed message arrives after reconnect; distress message shows the sender help chips while another member sees nothing, a real moderator sees it (urgent, with the "rules miss emergencies" note) and removal reaches the live reader; ordinary users get a not-found page and 403 on the API; ratings reject phone numbers, need ≥ 5 before showing an average, and update in place.
- Test-side fixes: shared-DB leakage between browser projects (made tests order-independent); streamed pages can't change status codes so 404 is asserted by content.

### Entry 021 — Stage 3 regression gate · PASSED (local, simulated notifications)

- 2026-10-10 ~18:07 IST: `format:check`, `typecheck`, `lint` pass; `npm test` **18 files, 383/383**; `npm run build` pass (rooms, moderation, 15 APIs); `npm run test:e2e` **44/44**; `npm audit --omit=dev` 0.
- Not verified/claimed: triage adequacy (KI-016), real moderator operations (KI-018), multi-host realtime or load (KI-019), verified room location (KI-017), physical devices.
- **User instruction (2026-10-10): stop after Stage 3.** Stages 4–7 (campus, offline, Cline Copilot, final regression/documents) were not started. Remaining documents from the master prompt not yet created: `ARCHITECTURE.md` refresh, `TESTING.md` rewrite (KI-002), `CLINE_SDK_INTEGRATION.md` implementation status (still design-only), final delivery report.
- Next exact action (if resumed): Stage 4 — design `venues/venue_points/responders/assistance_requests` migration reusing rooms, places and SOS.
