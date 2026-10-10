# Known issues register

Resolved issues are kept as history. Severity: Critical / High / Medium / Low.
Fix status: `OPEN`, `IN_PROGRESS`, `RESOLVED`, `ACCEPTED` (documented limitation).

| ID     | Severity | Feature             | Fix status           |
| ------ | -------- | ------------------- | -------------------- |
| KI-001 | Medium   | Build/environment   | RESOLVED             |
| KI-002 | Low      | Docs                | OPEN                 |
| KI-003 | Medium   | Auth / tests        | RESOLVED             |
| KI-004 | Low      | Tooling security    | ACCEPTED             |
| KI-005 | High     | P1 Journey Guardian | RESOLVED (local)     |
| KI-006 | Medium   | Data / P2           | OPEN                 |
| KI-007 | High     | P2 places           | ACCEPTED (mitigated) |
| KI-008 | Medium   | P2 routing          | ACCEPTED (labelled)  |
| KI-009 | Low      | P4 Copilot          | OPEN                 |
| KI-010 | High     | Notifications       | ACCEPTED             |
| KI-011 | High     | P4 Copilot / deps   | OPEN                 |
| KI-012 | Medium   | P1 Journey Guardian | ACCEPTED             |
| KI-013 | Medium   | P2 map              | OPEN                 |
| KI-014 | Medium   | P2 Safe Havens      | OPEN                 |
| KI-015 | Low      | P2 search           | OPEN                 |
| KI-016 | High     | Triage              | OPEN                 |
| KI-017 | Medium   | Rooms               | OPEN                 |
| KI-018 | Medium   | Rooms/moderation    | OPEN                 |
| KI-019 | Low      | Rooms               | OPEN                 |

## KI-001 — Lockfile not installable on macOS (RESOLVED)

- Reproduce: clone on macOS arm64, `npm ci`, then `npm test`.
- Expected: clean install, tests run. Actual: `EUSAGE` missing `lightningcss-*`; after `npm install`, Vitest failed with `Cannot find native binding` (rolldown).
- Root cause: confirmed — lockfile created on Windows listed only the win32 optional native binary (npm/cli#4828).
- Fix: lockfile regenerated; `npm ci --dry-run` passes; 202/202 tests pass.
- Journey: Entry 001.

## KI-002 — `docs/TESTING.md` and parts of old docs are Windows-specific (OPEN)

- Contains `Set-Location 'C:\Users\...'` and PowerShell-only commands; historical numbers describe the Windows run.
- Workaround: use the commands in `README.md`. Fix planned in Stage 7 (posix commands, preserve history).

## KI-003 — Production auth rate-limit defaults lack an explicit regression test (RESOLVED)

- E2E needed relaxed limits (Entry 003). The relaxation is gated to `NODE_ENV !== "production"`, but no test asserts that production still uses 30/min and 3/10 s.
- Fixed: `tests/auth-limits.test.ts` asserts the override is ignored in production. Journey Entry 010.

## KI-004 — Five high-severity advisories in dev-only lint toolchain (ACCEPTED)

- Chain: `eslint-config-next` → fast-glob → micromatch → braces (GHSA-vfj7-8cjw-p6xm). `npm audit --omit=dev` is the production signal. Details in `SECURITY_AND_PRIVACY.md`. Re-check each stage; re-evaluated after adding `@cline/sdk`.

## KI-005 — Journey Guardian is incomplete (RESOLVED for local/simulated operation)

- Missing: server-side overdue/grace/escalation processing, scheduler wiring, UI, share links, tests; `check-in` semantics wrong (requires a new ETA).
- Expected: ETA passes → `check_in_due` → after grace → `escalated` with notifications via the existing outbox. Actual: statuses `check_in_due`/`escalated` are never set.
- Resolution: Entries 008–009, 012 (42 service/API tests, 10 component tests, 3×2 browser tests). Still unverified: real SMS, a production scheduler, share links (deferred).
- Journey: Assessment, Entries 008–012.

## KI-006 — Provided CSV is synthetic (OPEN)

- Evidence: Entry 004. Must not be presented as real data. Untracked in Git; owner to confirm whether to commit (2.9 MB) or keep local. Real statistics source (NCRB) not yet connected.

## KI-007 — Public Overpass instability (ACCEPTED, mitigated)

- Reproduce: combined multi-category query for Bengaluru/Jaipur against `overpass-api.de` → HTTP 504. Evidence: Entry 006.
- Mitigation implemented: per-category queries, 24 h cache with stale fallback, 12 s timeout, one mirror, paced calls, honest per-category failure UI. Live smoke on 2026-10-10 still saw about a third of category queries fail (HTTP 5xx) on the public server. Not suitable for production load without a self-hosted/commercial Overpass instance.

## KI-008 — OSRM public demo is vehicle-only (ACCEPTED, labelled)

- Confirmed 2026-10-10: foot, driving and bike requests return identical results (3981 m / 396 s), so no walking routing exists. UI and API label routes as vehicle road routes, show vehicle time only and never rank safety. A walking-capable router (own OSRM/Valhalla instance) is needed for a real walking comparison.

## KI-009 — Cline SDK documentation discrepancies (OPEN)

- Upstream README shows `result.text`; installed 0.0.92 returns `outputText`. Code follows the installed types. Live model call unverified until `CLINE_API_KEY` is provided.

## KI-010 — No real SMS provider (ACCEPTED)

- Only a labelled development simulation exists; production fails closed with `PROVIDER_NOT_CONFIGURED`. Real delivery, receipts and acknowledgement are unverified.

## KI-011 — `@cline/sdk@0.0.92` adds 34 production audit advisories (OPEN)

- Reproduce: `npm install --save-exact @cline/sdk@0.0.92 && npm audit --omit=dev` → 5 low, 11 moderate, 14 high, 4 critical (e.g. `simple-git`, `node-forge`, `undici`, SAP AI SDK packages), all transitive via `@cline/core`/`@cline/llms`.
- Expected: no new high/critical production advisories. Actual: as above. Whether any vulnerable path is reachable from `Agent`/`createTool` use is not yet assessed.
- Workaround: SDK removed until Stage 6 (production audit back to 0). Stage 6 must assess reachability, try `overrides`, and record an ADR.
- Journey: Entry 011.

## KI-012 — Journey check-in prompts exist only in the open page (ACCEPTED)

- The user is prompted in-app (the page polls the server every 20 s and on tab focus). There is no push, SMS or call to the user themself, so a closed tab means no prompt — only the eventual contact notice. Escalation itself runs on the server and does not need the tab.
- The "scheduler not running" banner is shown when the heartbeat is missing/stale (>3 min).

## KI-013 — Map tiles verified only against a local stub in the browser (OPEN)

- E2E tests use a local tile stub; a real tile was fetched with curl (HTTP 200), but real in-browser rendering of OSM tiles, the Referer behaviour (`referrerPolicy: "origin"` on the tile layer) and OSM tile-policy compliance under real use are unverified. Public OSM tiles must not carry production traffic.

## KI-014 — No Safe Haven onboarding or verification workflow (OPEN)

- The `safe_havens` table, verified-only queries and demo fixtures exist, but nobody can apply or verify a Safe Haven yet (needs moderator roles, Stage 3/4). Real installs show **no** Safe Havens until then.

## KI-015 — No place-name search (OPEN)

- Users choose a city centre, device location, or tap the map. Nominatim is not integrated (its policy forbids autocomplete and bulk use); a server-side, cached, 1 req/s geocoder is a possible addition.

## KI-016 — Triage misses about half of urgent messages (OPEN, by design limitation)

- Reproduce: `npx tsx scripts/triage-eval.ts tests/fixtures/triage-eval-heldout2.json` → 44/61 exact; urgent recall 6/12, distress 4/8; example misses "two men on a motorbike are circling me, please someone come" and "somebody is breaking the door of my room right now" (→ `general`). False positive: "my friend is following me on instagram haha" (→ urgent).
- Expected: reliable emergency detection. Actual: weak rules. Mitigation: triage only flags to moderators and offers the sender help chips; SOS/112 are always visible and never gated. No model refinement yet (needs `CLINE_API_KEY`, Stage 6). Evidence: `docs/SAFETY_TRIAGE.md`; journey Entry 021.

## KI-017 — Room membership is self-reported (OPEN)

- A user can join any area room by claiming a position there; the server cannot verify it. Limits: ≤ 5 rooms per user, rate limits, moderator bans (a banned account can create a new account). Acceptable for local information rooms; not a defence against coordinated brigading.

## KI-018 — No moderator onboarding, escalation, or on-call coverage (OPEN)

- Moderators exist only via an operator script. Nobody is notified of new flags (the queue refreshes every 20 s while open); a real deployment needs staffed moderation, response SLAs and a policy for what moderators do with a genuine emergency. The queue says so.

## KI-019 — Realtime is single-host and untested at scale (OPEN)

- In-process pub/sub (ADR 0001) is correct on one Node process. Not load-tested; multiple instances would silently split rooms. Reconnect, replay (Last-Event-ID / history), watchdog and offline/online handling are covered by unit and browser tests; slow-consumer shedding is implemented but only unit-reasoned.
