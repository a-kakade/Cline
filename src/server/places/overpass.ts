import { z } from "zod";
import type { OsmCategoryId, PlacesErrorCode } from "@/lib/places-types";

// Tag filters per category. A mapped tag is NOT a claim of verification.
const OSM_FILTERS: Record<OsmCategoryId, [string, string][]> = {
  police: [["amenity", "police"]],
  hospital: [["amenity", "hospital"]],
  ambulance: [["emergency", "ambulance_station"]],
  pharmacy: [["amenity", "pharmacy"]],
  bus_stop: [["highway", "bus_stop"]],
  toilets: [["amenity", "toilets"]],
  help_point: [
    ["emergency", "phone"],
    ["amenity", "help_point"],
  ],
  transit: [
    ["railway", "station"],
    ["station", "subway"],
  ],
};
export const ELEMENT_LIMIT = 200;

export function buildQuery(
  category: OsmCategoryId,
  lat: number,
  lon: number,
  radiusM: number,
) {
  const around = `(around:${Math.round(radiusM)},${lat.toFixed(5)},${lon.toFixed(5)})`;
  const parts = OSM_FILTERS[category]
    .map(([k, v]) => `nwr["${k}"="${v}"]${around};`)
    .join("");
  return `[out:json][timeout:15];(${parts});out tags center ${ELEMENT_LIMIT};`;
}

export type RawPlace = {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
  address: string | null;
  phone: string | null;
  opening_hours: string | null;
  last_confirmed: string | null;
  source_url: string;
};

const elementSchema = z.object({
  type: z.enum(["node", "way", "relation"]),
  id: z.number().int(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  tags: z.record(z.string(), z.string()).optional(),
});
const responseSchema = z.object({
  elements: z.array(z.unknown()),
  remark: z.string().optional(),
});

const text = (value: string | undefined, max: number) => {
  const cleaned = value
    ?.replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return cleaned ? cleaned : null;
};

function address(tags: Record<string, string>) {
  const full = text(tags["addr:full"], 200);
  if (full) return full;
  const line = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:suburb"],
    tags["addr:city"],
    tags["addr:postcode"],
  ]
    .filter((p) => p && p.trim())
    .join(", ");
  return text(line, 200);
}

/** Parse an Overpass JSON body. Malformed elements are skipped, never repaired. */
export function parseElements(body: unknown): {
  places: RawPlace[];
  truncated: boolean;
  remark: string | null;
} {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new OverpassError("PROVIDER_INVALID");
  const places: RawPlace[] = [];
  for (const raw of parsed.data.elements) {
    const el = elementSchema.safeParse(raw);
    if (!el.success) continue;
    const { type, id, tags = {} } = el.data;
    const lat = el.data.lat ?? el.data.center?.lat;
    const lon = el.data.lon ?? el.data.center?.lon;
    if (
      lat === undefined ||
      lon === undefined ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    )
      continue;
    places.push({
      id: `osm:${type}/${id}`,
      name: text(tags.name ?? tags["name:en"], 120),
      lat,
      lon,
      address: address(tags),
      phone: text(tags.phone ?? tags["contact:phone"], 60),
      opening_hours: text(tags.opening_hours, 200),
      last_confirmed: text(tags.check_date ?? tags["survey:date"], 20),
      source_url: `https://www.openstreetmap.org/${type}/${id}`,
    });
  }
  return {
    places,
    truncated: parsed.data.elements.length >= ELEMENT_LIMIT,
    remark: parsed.data.remark ?? null,
  };
}

export class OverpassError extends Error {
  constructor(public code: PlacesErrorCode) {
    super(code);
  }
}

export type OverpassOptions = {
  endpoints?: string[];
  fetch?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
  /** Minimum gap between upstream calls; keeps us within the public usage policy. */
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
};
export const DEFAULT_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export class OverpassClient {
  private lastCall = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private opts: Required<OverpassOptions>;
  constructor(options: OverpassOptions = {}) {
    this.opts = {
      endpoints:
        options.endpoints ??
        (process.env.OVERPASS_ENDPOINTS
          ? process.env.OVERPASS_ENDPOINTS.split(",")
              .map((e) => e.trim())
              .filter(Boolean)
          : DEFAULT_ENDPOINTS),
      fetch: options.fetch ?? fetch,
      timeoutMs: options.timeoutMs ?? 12_000,
      userAgent:
        options.userAgent ??
        process.env.OVERPASS_USER_AGENT ??
        "SakhiSafetyApp/0.1 (self-hosted; set OVERPASS_USER_AGENT)",
      minIntervalMs: options.minIntervalMs ?? 1_000,
      sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      clock: options.clock ?? Date.now,
    };
  }

  // Calls are serialised and paced so concurrent users cannot hammer the public service.
  query(ql: string) {
    const run = this.queue.then(() => this.run(ql));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(ql: string) {
    let last: OverpassError = new OverpassError("PROVIDER_UNAVAILABLE");
    for (const endpoint of this.opts.endpoints) {
      const wait = this.lastCall + this.opts.minIntervalMs - this.opts.clock();
      if (wait > 0) await this.opts.sleep(wait);
      this.lastCall = this.opts.clock();
      let badRequest = false;
      try {
        const response = await this.opts.fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "user-agent": this.opts.userAgent,
          },
          body: new URLSearchParams({ data: ql }).toString(),
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
        if (response.status === 429) {
          last = new OverpassError("PROVIDER_RATE_LIMITED");
          continue;
        }
        if (response.status === 400) {
          badRequest = true;
          throw new OverpassError("PROVIDER_INVALID");
        }
        if (!response.ok) {
          last = new OverpassError(
            response.status === 504 || response.status === 408
              ? "PROVIDER_TIMEOUT"
              : "PROVIDER_ERROR",
          );
          continue;
        }
        let json: unknown;
        try {
          json = await response.json();
        } catch {
          last = new OverpassError("PROVIDER_INVALID");
          continue;
        }
        const parsed = parseElements(json);
        // A 200 with a runtime-error remark is an upstream failure, even with partial rows.
        if (
          parsed.remark &&
          /runtime error|timed out|out of memory/i.test(parsed.remark)
        ) {
          last = new OverpassError("PROVIDER_TIMEOUT");
          continue;
        }
        return parsed;
      } catch (error) {
        if (error instanceof OverpassError) {
          // A rejected query would fail identically on the mirror.
          if (error.code === "PROVIDER_INVALID" && badRequest) throw error;
          last = error;
          continue;
        }
        last = new OverpassError(
          error instanceof Error &&
            (error.name === "TimeoutError" || error.name === "AbortError")
            ? "PROVIDER_TIMEOUT"
            : "PROVIDER_UNAVAILABLE",
        );
      }
    }
    throw last;
  }
}
