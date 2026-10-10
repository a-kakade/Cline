import { existsSync, readFileSync, writeFileSync } from "node:fs";
import raw from "../src/data/demo-hotspots.json";

// Snapshots REAL OpenStreetMap services (police, hospitals, metro/rail stations, 24h
// pharmacies) around the demo hotspots into src/data/demo-services.json, so the demo map
// shows correctly identified nearest services without waiting on the public Overpass API.
// Usage: npx tsx scripts/fetch-services.ts   (about a minute; polite, serial requests)

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const UA = "SakhiSafetyApp-demo-snapshot/0.1 (local development)";
const MARGIN = 0.06;
const QUERIES: Record<string, string[]> = {
  police: ['nwr["amenity"="police"]'],
  hospital: ['nwr["amenity"="hospital"]'],
  transit: ['nwr["railway"="station"]', 'nwr["station"="subway"]'],
  pharmacy: ['nwr["amenity"="pharmacy"]["opening_hours"~"24/7"]'],
};

type El = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

// Resumable: raw answers are cached so a rate-limited run can simply be restarted.
const CACHE = process.env.SNAPSHOT_CACHE ?? "";
const cache: Record<string, El[]> =
  CACHE && existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};

async function overpass(ql: string): Promise<El[]> {
  if (cache[ql]) return cache[ql];
  const els = await overpassLive(ql);
  cache[ql] = els;
  if (CACHE) writeFileSync(CACHE, JSON.stringify(cache));
  return els;
}

async function overpassLive(ql: string): Promise<El[]> {
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "user-agent": UA,
          },
          body: new URLSearchParams({ data: ql }).toString(),
          signal: AbortSignal.timeout(90_000),
        });
        if (r.ok) {
          const j = (await r.json()) as { elements: El[]; remark?: string };
          if (!/runtime error|timed out/i.test(j.remark ?? ""))
            return j.elements;
        }
      } catch {
        /* try the next endpoint */
      }
      await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
    }
  }
  throw new Error(`Overpass failed for ${ql.slice(0, 60)}`);
}

const cities = [...new Set(raw.map((h) => h.city))];
const places = new Map<string, unknown>();
for (const city of cities) {
  const pts = raw.filter((h) => h.city === city);
  const s = Math.min(...pts.map((p) => p.lat)) - MARGIN;
  const n = Math.max(...pts.map((p) => p.lat)) + MARGIN;
  const w = Math.min(...pts.map((p) => p.lon)) - MARGIN;
  const e = Math.max(...pts.map((p) => p.lon)) + MARGIN;
  for (const [category, filters] of Object.entries(QUERIES)) {
    const box = `(${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)})`;
    const ql = `[out:json][timeout:80];(${filters.map((f) => `${f}${box};`).join("")});out tags center;`;
    const els = await overpass(ql);
    let kept = 0;
    for (const el of els) {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      const name = (el.tags?.name ?? el.tags?.["name:en"] ?? "").trim();
      if (lat === undefined || lon === undefined || !name) continue;
      const id = `osm:${el.type}/${el.id}`;
      places.set(id, {
        id,
        category,
        name,
        lat: Number(lat.toFixed(5)),
        lon: Number(lon.toFixed(5)),
        phone: el.tags?.phone ?? el.tags?.["contact:phone"] ?? null,
        hours: el.tags?.opening_hours ?? null,
      });
      kept++;
    }
    console.log(`${city} ${category}: ${kept} named of ${els.length}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}
writeFileSync(
  "src/data/demo-services.json",
  JSON.stringify({
    fetched_at: new Date().toISOString().slice(0, 10),
    attribution: "© OpenStreetMap contributors (ODbL)",
    places: [...places.values()],
  }),
);
console.log(`Wrote ${places.size} places.`);
