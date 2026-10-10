import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import next from "next";
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "../src/server/auth";
import { migrate, openDatabase } from "../src/server/database";
import { seedDemo } from "../src/server/demo-seed";
import { MODERATOR_EMAIL, MODERATOR_PASSWORD } from "../tests/e2e/constants";

// Never reuse a developer's account data, auth secret, or notification settings.
const directory = mkdtempSync(join(tmpdir(), "sakhi-foundation-e2e-"));
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.DATABASE_PATH = join(directory, "foundation.sqlite");
process.env.JOB_SECRET = randomBytes(48).toString("base64url");
process.env.NOTIFICATION_PROVIDER = "simulation";
process.env.EMERGENCY_NUMBER = "112";
// The suite signs up many users from one IP faster than the production limit (30/min).
process.env.AUTH_RATE_LIMIT_MAX = "1000";

// Local stand-ins for third-party map services, so browser tests never depend on
// (or load) public servers. Overpass answers from a recorded real response plus one
// clearly named test pharmacy; requests near Patna deterministically fail (HTTP 504)
// to exercise provider-failure handling. OSRM returns two fixed routes.
const overpassFixture = JSON.parse(
  readFileSync(
    new URL(
      "../tests/fixtures/overpass-delhi-police-hospital.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { elements: { tags: Record<string, string> }[] };
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);
const stub = createServer((request, response) => {
  const url = request.url ?? "";
  if (url.startsWith("/tiles/")) {
    response.setHeader("content-type", "image/png").end(PNG);
    return;
  }
  if (url.startsWith("/osrm/")) {
    const line = (pts: number[][]) => ({
      type: "LineString",
      coordinates: pts,
    });
    response.setHeader("content-type", "application/json").end(
      JSON.stringify({
        code: "Ok",
        routes: [
          {
            distance: 3981,
            duration: 396,
            geometry: line([
              [77.209, 28.6139],
              [77.22, 28.6139],
              [77.2295, 28.6129],
            ]),
          },
          {
            distance: 5572,
            duration: 562,
            geometry: line([
              [77.209, 28.6139],
              [77.22, 28.595],
              [77.2295, 28.6129],
            ]),
          },
        ],
      }),
    );
    return;
  }
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const query = decodeURIComponent(body.replace(/\+/g, " "));
    const lat = Number(/around:\d+,([-\d.]+),/.exec(query)?.[1]);
    if (Math.abs(lat - 25.59) < 0.1) {
      response.statusCode = 504;
      response.end("gateway timeout");
      return;
    }
    const wanted = query.includes('"police"')
      ? "police"
      : query.includes('"hospital"')
        ? "hospital"
        : null;
    const elements = wanted
      ? overpassFixture.elements.filter((e) => e.tags.amenity === wanted)
      : query.includes('"pharmacy"')
        ? [
            {
              type: "node",
              id: 900000001,
              lat: 28.6145,
              lon: 77.2095,
              tags: { name: "Test Pharmacy (e2e stub)", amenity: "pharmacy" },
            },
          ]
        : [];
    response
      .setHeader("content-type", "application/json")
      .end(JSON.stringify({ elements }));
  });
});
await new Promise<void>((resolve, reject) => {
  stub.once("error", reject);
  stub.listen(3101, "127.0.0.1", () => resolve());
});
process.env.OVERPASS_ENDPOINTS = "http://127.0.0.1:3101/overpass";
process.env.OSRM_URL = "http://127.0.0.1:3101/osrm";
process.env.MAP_TILE_URL = "http://127.0.0.1:3101/tiles/{z}/{x}/{y}.png";

const db = openDatabase(process.env.DATABASE_PATH);
try {
  const migrations = await getMigrations(createAuth(db).options);
  await migrations.runMigrations();
  migrate(db);
  // A moderator account for browser tests of the moderation queue (temp DB only).
  const auth = createAuth(db);
  const created = await auth.api.signUpEmail({
    body: {
      name: "E2E Moderator",
      email: MODERATOR_EMAIL,
      password: MODERATOR_PASSWORD,
    },
  });
  db.prepare(
    "INSERT INTO user_roles(user_id,role,granted_at) VALUES(?,?,?)",
  ).run(created.user.id, "moderator", Date.now());
  // Three synthetic rows near central Delhi: exercises the labelled demo-data path.
  seedDemo(
    db,
    [
      "city,latitude,longitude,crime_type,lighting_score,incident_timestamp",
      "Delhi,28.6139,77.2090,Stalking,5,2025-05-14 12:40:25",
      "Delhi,28.6140,77.2091,Assault,5,2025-05-10 12:40:25",
      "Delhi,28.6141,77.2092,Harassment,1.5,2025-05-12 12:40:25",
    ].join("\n"),
  );
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
  stub.closeAllConnections();
  await new Promise<void>((resolve) => stub.close(() => resolve()));
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
