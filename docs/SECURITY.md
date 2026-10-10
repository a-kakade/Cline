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

## Release blockers

This foundation is not a production emergency service. Configure a real notification integration and verified delivery behavior, independent scheduler monitoring, HTTPS, persistent encrypted storage, backups/restore drills, account recovery, retention operations, incident response and external security review before relying on it for personal safety.

## Dependency audit (2026-10-10)

`npm audit --omit=dev --audit-level=high` reports0 vulnerabilities. The full audit reports5 high-severity entries in one **development-only** dependency chain: Next's ESLint plugin -> fast-glob -> micromatch -> braces (GHSA-vfj7-8cjw-p6xm, nested-pattern stack exhaustion). npm offers only a breaking downgrade to eslint-config-next14, incompatible with the selected Next16 baseline; it has not been forced. No patched braces version is reported. Lint only trusted repository patterns; do not expose lint as a public service. Track the upstream patch and rerun the full audit before release. This finding is not concealed by the production-only audit result.
