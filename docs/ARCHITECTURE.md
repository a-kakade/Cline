# Architecture

## Foundation decision

The supplied GitHub repository was empty. Node 22.16 and npm were installed; no PostgreSQL server, Docker executable, Supabase configuration or SMS credentials were found. The initial deployment is therefore one Next.js Node server with Better Auth and SQLite (better-sqlite3). This is a real relational database and real account authentication, not an in-memory demo. No additional backend is required.

- App Router pages/components: accessible presentation, input, local UI progress.
- Route handlers: session validation, same-origin write protection, bounded JSON parsing, domain invocation and consistent responses.
- `src/server`: server domain services and parameterized persistence. No client import of database/auth secrets.
- Better Auth owns password hashing, identity, session cookies and authentication rate limits. The application never accepts a client-supplied owner ID.
- Database migrations: Better Auth's installed schema migration API first, then versioned SQL application migrations with transactional application and a migrations ledger.
- UTC integer milliseconds are stored; local time formatting belongs to the UI.

## Deployment boundary

SQLite has no row-level security: authorization must be enforced by every server query. The DB file is not public and must be accessible only by the application OS account. WAL and a busy timeout support concurrent requests on one host. Domain transitions use short synchronous transactions; never await a provider inside a DB transaction.

Deploy to a long-running Node host with a persistent encrypted local volume, TLS, tested backups and an independently configured authenticated job runner. Do not deploy this configuration to an ephemeral/serverless filesystem or several hosts sharing a network SQLite file. A move to PostgreSQL requires a deliberate migration and equivalent locking/ownership tests, not just changing a connection string.

## Planned integration boundaries

Notifications will be behind an explicit provider interface; persistence/acceptance/delivery remain distinct. No provider secrets belong in public environment variables. Journey scheduling will reuse dispatch rather than invent another channel. AI, community reports, evidence storage, mesh messaging and risk maps are out of scope. The future AI boundary is documented separately and cannot perform emergency state mutations.
