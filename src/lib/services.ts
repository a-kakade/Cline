// Nearby help for the demo map. Police, hospitals, stations and 24h pharmacies are REAL
// OpenStreetMap data, snapshotted by scripts/fetch-services.ts (not verified by Sakhi).
// Women help desks and safe zones are SYNTHETIC demo records generated deterministically
// around each demo hotspot below; they are not real places.
import data from "@/data/demo-services.json";
import hotspotData from "@/data/demo-hotspots.json";
import { haversineMeters, type LatLon } from "@/lib/geo";

export type ServiceCategory =
  "police" | "hospital" | "transit" | "pharmacy" | "women_help" | "safe_zone";
export type Service = {
  id: string;
  category: ServiceCategory;
  name: string;
  lat: number;
  lon: number;
  phone: string | null;
  hours: string | null;
  distance_m: number;
  /** True for generated demo records. */
  synthetic: boolean;
};
export const SNAPSHOT = {
  fetched_at: data.fetched_at,
  attribution: data.attribution,
};
export const MAX_RADIUS_M = 12_000;

// OSM sometimes tags shops and clinics as hospitals; keep them out of the emergency list.
const NOT_A_HOSPITAL =
  /medical shop|medicals?\b|pharma|chemist|optical|vision care|eye care|dental|diagnostic|scan cent/i;

type Row = Omit<Service, "distance_m" | "category" | "synthetic"> & {
  category: ServiceCategory;
};
const real: Row[] = (data.places as Row[]).filter(
  (r) =>
    !/\(u\/c\)|under construction/i.test(r.name) &&
    !(r.category === "hospital" && NOT_A_HOSPITAL.test(r.name)),
);

// ---- Synthetic demo records ------------------------------------------------
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SAFE_KINDS: [string, string][] = [
  ["Community help desk", "Staffed 6 am – 11 pm"],
  ["24x7 safe store", "Open 24 hours"],
  ["Metro-side help booth", "Staffed 6 am – 11 pm"],
  ["Mall security desk", "10 am – 10 pm"],
  ["Petrol pump safe stop", "Open 24 hours"],
  ["Bus stand help desk", "5 am – midnight"],
  ["Night watch post", "8 pm – 6 am"],
  ["Campus safe point", "Open 24 hours"],
];
const PLACE_WORDS = [
  "Main Road",
  "Market",
  "Circle",
  "Cross",
  "Bus Stand",
  "Sector 4",
  "Park Gate",
  "Junction",
];

function synthetic(): Row[] {
  const out: Row[] = [];
  for (const h of hotspotData) {
    const r = rng(`svc:${h.id}`);
    const place = (minM: number, maxM: number) => {
      const bearing = r() * Math.PI * 2;
      const d = minM + r() * (maxM - minM);
      return {
        lat: Number((h.lat + (Math.cos(bearing) * d) / 111_320).toFixed(5)),
        lon: Number(
          (
            h.lon +
            (Math.sin(bearing) * d) /
              (111_320 * Math.cos((h.lat * Math.PI) / 180))
          ).toFixed(5),
        ),
      };
    };
    for (let i = 0; i < 4; i++)
      out.push({
        id: `demo:${h.id}:w${i}`,
        category: "women_help",
        name: `Women help desk · ${h.name} ${PLACE_WORDS[Math.floor(r() * PLACE_WORDS.length)]}`,
        ...place(250 + i * 900, 700 + i * 1500),
        phone: "181",
        hours: "Helpline 181 is open 24 hours",
      });
    for (let i = 0; i < 9; i++) {
      const [kind, hours] = SAFE_KINDS[Math.floor(r() * SAFE_KINDS.length)];
      out.push({
        id: `demo:${h.id}:s${i}`,
        category: "safe_zone",
        name: `${kind} · ${h.name} ${PLACE_WORDS[Math.floor(r() * PLACE_WORDS.length)]}`,
        ...place(150 + i * 650, 500 + i * 1100),
        phone: null,
        hours,
      });
    }
  }
  return out;
}
const demo = synthetic();

const CAPS: Record<ServiceCategory, number> = {
  police: 8,
  hospital: 8,
  transit: 8,
  pharmacy: 4,
  women_help: 5,
  safe_zone: 8,
};

/** Everything of each kind within `radiusM` of a point, nearest first, with a cap per kind. */
export function servicesNear(
  at: LatLon,
  radiusM: number = MAX_RADIUS_M,
  options: { cap?: boolean } = {},
): Service[] {
  const radius = Math.min(radiusM, MAX_RADIUS_M);
  const found = [...real, ...demo]
    .map((r): Service => ({
      ...r,
      distance_m: Math.round(haversineMeters(at, r)),
      synthetic: r.id.startsWith("demo:"),
    }))
    .filter((s) => s.distance_m <= radius)
    .sort((a, b) => a.distance_m - b.distance_m);
  const taken: Service[] = [];
  const counts: Partial<Record<ServiceCategory, number>> = {};
  for (const s of found) {
    // OSM often maps one station twice (building + point); keep the nearer copy.
    if (
      !s.synthetic &&
      taken.some(
        (o) =>
          o.name === s.name &&
          o.category === s.category &&
          haversineMeters(o, s) < 250,
      )
    )
      continue;
    if (options.cap !== false && (counts[s.category] ?? 0) >= CAPS[s.category])
      continue;
    counts[s.category] = (counts[s.category] ?? 0) + 1;
    taken.push(s);
  }
  return taken;
}

export const EMERGENCY_CATEGORIES: ServiceCategory[] = ["police", "hospital"];
export const isEmergency = (s: Pick<Service, "category">) =>
  EMERGENCY_CATEGORIES.includes(s.category);
