import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import next from "next";
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "../src/server/auth";
import { migrate, openDatabase } from "../src/server/database";

// Never reuse a developer's account data, auth secret, or notification settings.
const directory = mkdtempSync(join(tmpdir(), "sakhi-foundation-e2e-"));
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.DATABASE_PATH = join(directory, "foundation.sqlite");
process.env.JOB_SECRET = randomBytes(48).toString("base64url");
process.env.NOTIFICATION_PROVIDER = "simulation";
process.env.EMERGENCY_NUMBER = "112";

const db = openDatabase(process.env.DATABASE_PATH);
try {
  const migrations = await getMigrations(createAuth(db).options);
  await migrations.runMigrations();
  migrate(db);
} catch (error) {
  db.close();
  rmSync(directory, { recursive: true, force: true });
  throw error;
}
db.close();

const app = next({ dev: true, hostname: "localhost", port: 3000 });
const handler = app.getRequestHandler();
const server = createServer((request, response) => {
  void handler(request, response).catch(() => {
    response.statusCode = 500;
    response.end("E2E server request failed.");
  });
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await app.close();
  // Next may own an open SQLite connection until process exit on Windows.
  // Best effort only: all artifacts are isolated in the OS temporary directory.
  try {
    rmSync(directory, { recursive: true, force: true });
  } catch {
    /* OS cleanup can remove a still-locked temporary database. */
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().finally(() => process.exit(0));
  });
}

try {
  await app.prepare();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(3000, () => resolve());
  });
  console.log("Isolated foundation E2E server ready at http://localhost:3000");
} catch (error) {
  await shutdown();
  throw error;
}
