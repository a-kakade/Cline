import Database from "better-sqlite3";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function openDatabase(path: string) {
  if (path !== ":memory:")
    mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  return db;
}

export function migrate(db: Database.Database) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const directory = resolve("migrations");
  for (const name of readdirSync(directory)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(name))
      continue;
    db.transaction(() => {
      db.exec(readFileSync(resolve(directory, name), "utf8"));
      db.prepare("INSERT INTO schema_migrations VALUES (?, ?)").run(
        name,
        Date.now(),
      );
    })();
  }
}

const globalDb = globalThis as typeof globalThis & {
  sakhiDb?: Database.Database;
};
export function getDatabase() {
  return (globalDb.sakhiDb ??= openDatabase(
    process.env.DATABASE_PATH || "./data/sakhi.sqlite",
  ));
}
