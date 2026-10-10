// Live smoke test of the third-party map services through SAKHI's own adapters.
// Makes a handful of real, polite requests. Run: npm run smoke:map
import { randomBytes } from "node:crypto";
process.env.BETTER_AUTH_SECRET ??= randomBytes(48).toString("base64url");
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.OVERPASS_USER_AGENT ??= "SakhiSafetyApp-smoke/0.1 (dev smoke test)";

const { createAuthFixture, signUp } = await import("../tests/helpers");
const { OverpassClient } = await import("../src/server/places/overpass");
const { PlacesService } = await import("../src/server/places/service");
const { RoutingService } = await import("../src/server/routing");

const fixture = await createAuthFixture();
const user = await signUp(fixture);
const places = new PlacesService(fixture.db, new OverpassClient());
let failures = 0;
for (const [name, lat, lon] of [
  ["Delhi", 28.6139, 77.209],
  ["Bengaluru", 12.9716, 77.5946],
  ["Jaipur", 26.9124, 75.7873],
] as const) {
  const r = await places.nearby(user.id, {
    lat,
    lon,
    radius_m: 2000,
    categories: ["police", "hospital", "pharmacy"],
  });
  const summary = r.sources
    .map((s) => `${s.category}:${s.status}${s.error ? `(${s.error})` : ""}`)
    .join(" ");
  const counts = ["police", "hospital", "pharmacy"]
    .map((c) => `${c}=${r.places.filter((p) => p.category === c).length}`)
    .join(" ");
  const withPhone = r.places.filter((p) => p.phone).length;
  console.log(
    `${name}: ${counts} withPhone=${withPhone}/${r.places.length} | ${summary}`,
  );
  if (r.sources.every((s) => s.status === "failed")) failures++;
}
try {
  const routes = await new RoutingService(fixture.db).compare(user.id, {
    from: { lat: 28.6139, lon: 77.209 },
    to: { lat: 28.6129, lon: 77.2295 },
  });
  console.log(
    `OSRM: ${routes.routes.length} routes ${routes.routes.map((r) => `${r.distance_m}m/${r.duration_s}s`).join(", ")}`,
  );
} catch (e) {
  failures++;
  console.log(`OSRM failed: ${(e as Error).message}`);
}
fixture.close();
console.log(failures ? `SMOKE FAILED (${failures})` : "SMOKE OK");
process.exit(failures ? 1 : 0);
