# Database setup and operations

`npm run setup` generates local `.env.local` only if absent. `npm run db:migrate` loads that file, applies the installed Better Auth schema (`better-auth/db/migration` in 1.7.7), and then sorted, versioned SQL migrations. Each application migration and its ledger entry run in a transaction. Reruns do not erase records. Back up before upgrading Better Auth or changing existing schema. Once released, add migrations rather than edit applied SQL.

`DATABASE_PATH` is a server filesystem path, not a public URL. Default `./data/sakhi.sqlite` is relative to the app working directory. Parent directories are created automatically. Auth and product tables share one DB with foreign keys enabled, WAL journaling and a 5-second lock timeout. SQLite transactions serialize writers, which is appropriate for this single-host phase. Multi-host scaling requires PostgreSQL migration and new concurrency testing.

Tests create real users using Better Auth in isolated in-memory databases; browser tests use an isolated OS-temporary SQLite file. There is no seeded production user or shared demo password. Create your own local account at `/auth`; never put actual emergency/contact information into automated fixtures.

## Backup and deployment

Do not copy only an actively used `.sqlite` file while discarding its WAL. Use SQLite's online backup API or stop writes and checkpoint before a verified backup. Keep the filesystem outside web-served directories; restrict read/write permissions to the app service account, encrypt the volume and backups, and test restoration separately. Backups and external delivery providers have separate retention obligations.

## Ownership

Better Auth's user ID is the foreign-key owner. Product routes derive it exclusively from the validated session. All private reads and writes must include owner checks; unknown and other-user IDs both produce 404. SQLite does not provide RLS. Direct SQL access bypasses application access controls and is reserved for the trusted operator.

Contact limits are 20 per owner, unique normalized phone per owner; names and enabled booleans have DB constraints. Phone validity is not identity/ownership verification. Deleting a contact does not send a notification.
