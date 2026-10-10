# Security and deployment limitations

- Real Better Auth email/password sessions, minimum 12-character password, httpOnly provider cookies, seven-day sessions. No test-login route or impersonation header. Production cookies use the provider's HTTPS behavior.
- Email ownership verification and password-recovery mail are not configured. An entered email or contact phone must not be represented as verified. Before public rollout, configure and test account recovery/verification delivery and abuse monitoring.
- All application private API requests require a server-validated session. Mutations also require exact configured Origin. JSON bodies are bounded to 16 KiB. Unknown errors return a generic response, not stack traces or submitted values.
- Database calls are parameterized and must be scoped to authenticated ownership. SQLite has no RLS, so direct DB access must be restricted to the server process.
- Phone numbers and location are sensitive. Do not log request bodies, auth headers/cookies, message contents or DB rows. Auth library logging is disabled. Reverse-proxy logging must redact credentials and avoid request bodies.
- CSP, frame denial, no-referrer, nosniff, HSTS and geolocation-only permissions are configured. The baseline CSP permits inline Next.js scripts; a nonce-based strict CSP is additional deployment hardening, not presently claimed.
- Local `.env.local` is generated with random secrets and ignored by Git. Set Windows ACLs/Unix permissions and encrypt the DB volume/backups. SQLite is not application-layer encrypted.
- Production notification simulation must be refused. A provider acceptance is not recipient delivery. Ambiguous sends cannot be retried blindly.
- A phone call is always user-initiated. A trusted-contact notification does not contact emergency services. Browser GPS is permission-based and not reliable continuous background tracking.

## Retention policy

Keep only data required for the workflow. Contact deletion removes the contact; audit records contain opaque resource IDs, action and time only. The authenticated job clears alert coordinates after24hours, terminal alerts/delivery attempts after30days and audit events after90days. Run `npm run jobs:once` manually or an independent production scheduler at least once/minute. Retention is not automatic without this runner. Backups must obey an independently enforced expiry policy. Do not claim data is erased from backups immediately.

P0 dispatch snapshots enabled contact IDs, not phone/message copies. Provider attempts keep structured outcomes. UUID idempotency plus transactional outbox claims prevent duplicate dispatch from repeated requests. Provider timeouts/crash-ambiguous sends become unknown and are not automatically retried. Only definite retryable failures get a bounded retry. Browser simulation is labelled; NODE_ENV production refuses simulated sends. See `NOTIFICATIONS.md` for precise semantics.

## Journey Guardian data

- A journey stores destination, optional origin, ETA, chosen contact IDs, and an optional last-known location (only if the user opts in and the browser supplies a fresh fix). Coordinates are deleted when the journey is completed or cancelled and swept again by the retention job; finished journeys are deleted after 30 days.
- Contacts receive a message only on escalation (and a follow-up if the user later closes an escalated journey). Recipients are re-read at escalation time: a contact whose sharing was switched off in the meantime is not messaged.
- Escalation is performed by the protected job, never by the browser. `job_heartbeats` records the last completed run; the UI warns when it is missing or older than 3 minutes. The job secret authenticates the scheduler; configure an external scheduler, TLS and run-failure alerting before relying on this feature.
- SMS bodies strip control characters from user-supplied text. Audit records hold only opaque ids and action names.
- `AUTH_RATE_LIMIT_MAX` is a test-only override, ignored when `NODE_ENV=production` (regression-tested).

## Map and reports data

- Third parties and what they receive: Overpass gets a ~1 km grid point and a category (never the user's exact position); OSRM gets both route endpoints, only when the user asks to compare routes; the tile server gets tile coordinates and, via `referrerPolicy: origin`, the site origin. CSP `img-src` allows only the configured tile origin (`MAP_TILE_URL`); all API calls go to our own server (`connect-src 'self'`).
- User reports: position rounded to about 110 m, reporter id stored for rate limiting and abuse handling but never returned by any API, free text stripped of control characters, length-limited, rate-limited (5/min, 20/day, duplicate suppression). There is no moderation tooling yet (Stage 3), so malicious or coordinated reporting is not detected. Reports older than two years are deleted.
- Demo data is tagged at the row level, hidden by default and refused in production unless `ALLOW_DEMO_DATA=1`.
- Provider responses cached in `places_cache` contain only public OSM data; entries are deleted after 7 days.

## Area rooms, ratings and moderation

- Rooms are keyed by a public grid-cell id; no room is centred on a person. Joining requires a position inside the cell, which is self-reported, unverified and **not stored**; only the membership row is kept.
- Authorization is server-side on every read, post, history page and stream: non-members get 403; a banned or departed member's open stream is closed (event or heartbeat). SSE payloads and history contain pseudonymous aliases (HMAC of room+user with the server secret), message text and timestamps — no user ids, names, emails or coordinates (tested).
- Posting is validated (length, control/bidi characters stripped, ≤ 2 links), idempotent by client id, rate-limited (20/min), duplicate-suppressed; messages are deleted after 30 days. Reviews reject phone numbers and email addresses. Reports, blocks and bans are audited by opaque id only.
- Triage results and moderator alerts hold category/priority/ids, never coordinates or contact details; nothing is sent to the room, trusted contacts or emergency services automatically. The `moderator` role cannot be granted over HTTP.
- Open risks: self-reported membership, no moderation coverage, no abuse detection beyond rate limits and caps (KI-017/018).

## Release blockers

This foundation is not a production emergency service. Configure a real notification integration and verified delivery behavior, independent scheduler monitoring, HTTPS, persistent encrypted storage, backups/restore drills, account recovery, retention operations, incident response and external security review before relying on it for personal safety.

## Dependency audit (2026-10-10)

`npm audit --omit=dev` reports 0 vulnerabilities (re-checked 2026-10-10 after removing the unused Cline SDK, see KI-011). The full audit reports5 high-severity entries in one **development-only** dependency chain: Next's ESLint plugin -> fast-glob -> micromatch -> braces (GHSA-vfj7-8cjw-p6xm, nested-pattern stack exhaustion). npm offers only a breaking downgrade to eslint-config-next14, incompatible with the selected Next16 baseline; it has not been forced. No patched braces version is reported. Lint only trusted repository patterns; do not expose lint as a public service. Track the upstream patch and rerun the full audit before release. This finding is not concealed by the production-only audit result.
