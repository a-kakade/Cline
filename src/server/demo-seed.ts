import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { areaForPoint, isValidLatLon } from "@/lib/geo";

// Loads SYNTHETIC demonstration records. Everything inserted here is tagged
// source='synthetic_demo' (reports) or source='demo' (Safe Havens) so the API and
// UI can hide or label it. It is never real incident or venue data.

const TYPE_MAP: Record<string, string | null> = {
  Harassment: "harassment",
  "Verbal Abuse": "harassment",
  Stalking: "stalking",
  "Chain Snatching": "theft_or_snatching",
  Assault: "assault",
  "Unsafe Transport": "unsafe_transport",
  "Night Safety Complaint": "other",
  Kidnapping: "other",
  // Not street-level, location-bound events: skipped rather than mislabelled.
  "Cyber Crime": null,
  "Domestic Violence": null,
};

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((r) =>
    Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])),
  );
}

export type SeedOptions = { now?: number; rebase?: boolean };
export type SeedResult = {
  reports: number;
  hazards: number;
  skipped: number;
  havens: number;
};

export function seedDemo(
  db: Database.Database,
  csv: string,
  options: SeedOptions = {},
): SeedResult {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_DEMO_DATA !== "1"
  )
    throw new Error("Refusing to load demo data in production.");
  const now = options.now ?? Date.now();
  const rows = parseCsv(csv);
  const stamps = rows
    .map((r) => Date.parse(`${r.incident_timestamp.replace(" ", "T")}Z`))
    .filter(Number.isFinite);
  // Shift dates so the newest synthetic record is "today"; otherwise a 90-day window shows nothing.
  const shift =
    options.rebase !== false && stamps.length ? now - Math.max(...stamps) : 0;
  const insert = db.prepare(
    `INSERT INTO reports(id,kind,category,description,latitude,longitude,area_id,occurred_at,created_at,verification,status,source,reporter_id)
     VALUES(?,?,?,?,?,?,?,?,?,'unverified','visible','synthetic_demo',NULL)`,
  );
  const result: SeedResult = { reports: 0, hazards: 0, skipped: 0, havens: 0 };
  const cities = new Map<string, { lat: number; lon: number; n: number }>();
  db.transaction(() => {
    db.prepare("DELETE FROM reports WHERE source='synthetic_demo'").run();
    db.prepare("DELETE FROM safe_havens WHERE source='demo'").run();
    for (const r of rows) {
      const lat = Number(r.latitude);
      const lon = Number(r.longitude);
      const at = Date.parse(`${r.incident_timestamp.replace(" ", "T")}Z`);
      if (!isValidLatLon(lat, lon) || !Number.isFinite(at)) {
        result.skipped++;
        continue;
      }
      const c = cities.get(r.city) ?? { lat: 0, lon: 0, n: 0 };
      cities.set(r.city, { lat: c.lat + lat, lon: c.lon + lon, n: c.n + 1 });
      const occurred = at + shift;
      const area = areaForPoint(lat, lon).id;
      const category = TYPE_MAP[r.crime_type];
      if (category === undefined || category === null) result.skipped++;
      else {
        insert.run(
          randomUUID(),
          "incident",
          category,
          `DEMO (synthetic): ${r.crime_type}`,
          lat,
          lon,
          area,
          occurred,
          occurred,
        );
        result.reports++;
      }
      if (Number(r.lighting_score) > 0 && Number(r.lighting_score) <= 2) {
        insert.run(
          randomUUID(),
          "infrastructure_hazard",
          "poor_lighting",
          "DEMO (synthetic): low lighting score",
          lat,
          lon,
          area,
          occurred,
          occurred,
        );
        result.hazards++;
      }
    }
    const haven = db.prepare(
      `INSERT INTO safe_havens(id,name,kind,latitude,longitude,status,source,verification_method,verified_at,created_at,updated_at)
       VALUES(?,?,?,?,?,'verified','demo','Demonstration fixture — not a real location',?,?,?)`,
    );
    for (const [city, c] of cities) {
      const lat = c.lat / c.n;
      const lon = c.lon / c.n;
      for (const [i, d] of [0.0027, -0.0027].entries()) {
        haven.run(
          randomUUID(),
          `DEMO Safe Haven ${i === 0 ? "A" : "B"} (${city}) — not a real place`,
          "demo",
          lat + d,
          lon + d,
          now,
          now,
          now,
        );
        result.havens++;
      }
    }
  })();
  return result;
}
