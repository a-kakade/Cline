import type Database from "better-sqlite3";
import { z } from "zod";
import { boundingBox, haversineMeters } from "@/lib/geo";
import {
  CATEGORY_BY_ID,
  OSM_CATEGORY_IDS,
  type OsmCategoryId,
  type Place,
  type PlaceCategoryId,
  type PlacesResult,
  type SourceStatus,
} from "@/lib/places-types";
import { throttle } from "../audit";
import {
  buildQuery,
  OverpassClient,
  OverpassError,
  type RawPlace,
} from "./overpass";

export const ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";
const DAY = 86_400_000;
// Upstream queries use a ~1 km grid point instead of the user's exact position,
// so the user's precise location is never sent to a third party. The extra
// radius guarantees the true search circle is still covered.
const CELL_DEGREES = 0.01;
const CELL_MARGIN_M = 800;

const ids = [...OSM_CATEGORY_IDS, "safe_haven"] as [
  PlaceCategoryId,
  ...PlaceCategoryId[],
];
export const nearbySchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    radius_m: z.number().int().min(100).max(10_000).default(2000),
    categories: z.array(z.enum(ids)).min(1).max(8).optional(),
    per_category: z.number().int().min(1).max(50).default(10),
    include_demo: z.boolean().default(false),
  })
  .strict();
export type NearbyInput = z.input<typeof nearbySchema>;

export const demoAllowed = () =>
  process.env.NODE_ENV !== "production" || process.env.ALLOW_DEMO_DATA === "1";

type CachedEntry = {
  places: RawPlace[];
  truncated: boolean;
  fetched_at: number;
};

export class PlacesService {
  private inflight = new Map<
    string,
    Promise<{ places: RawPlace[]; truncated: boolean }>
  >();
  constructor(
    private db: Database.Database,
    private client: OverpassClient,
    private clock = Date.now,
    private ttlMs = DAY,
    private staleMs = 7 * DAY,
  ) {}

  async nearby(userId: string, input: unknown): Promise<PlacesResult> {
    const data = nearbySchema.parse(input);
    throttle(this.db, userId, "places", 30, this.clock());
    const categories = [...new Set(data.categories ?? ids)];
    const here = { lat: data.lat, lon: data.lon };
    const sources: SourceStatus[] = [];
    const places: Place[] = [];
    await Promise.all(
      categories.map(async (category) => {
        const radius = Math.min(
          data.radius_m,
          CATEGORY_BY_ID[category].maxRadiusM,
        );
        if (category === "safe_haven") {
          const found = this.safeHavens(
            here,
            radius,
            data.include_demo && demoAllowed(),
          );
          sources.push({
            category,
            provider: "safe_havens",
            status: "fresh",
            fetched_at: this.clock(),
          });
          places.push(...found.slice(0, data.per_category));
          return;
        }
        const result = await this.osmCategory(category, here, radius);
        sources.push(result.source);
        const mapped = result.places
          .map((p) => ({ raw: p, distance: haversineMeters(here, p) }))
          .filter((p) => p.distance <= radius)
          .sort(
            (a, b) =>
              a.distance - b.distance || a.raw.id.localeCompare(b.raw.id),
          )
          .slice(0, data.per_category)
          .map(({ raw, distance }): Place => ({
            id: raw.id,
            category,
            name: raw.name,
            lat: raw.lat,
            lon: raw.lon,
            distance_m: Math.round(distance),
            address: raw.address,
            phone: raw.phone,
            opening_hours: raw.opening_hours,
            last_confirmed: raw.last_confirmed,
            source: "osm",
            source_url: raw.source_url,
            verified: false,
            verification_note: null,
          }));
        places.push(...mapped);
      }),
    );
    sources.sort(
      (a, b) => categories.indexOf(a.category) - categories.indexOf(b.category),
    );
    places.sort(
      (a, b) => a.distance_m - b.distance_m || a.id.localeCompare(b.id),
    );
    return {
      places,
      sources,
      query: { radius_m: data.radius_m, categories },
      attribution: ATTRIBUTION,
    };
  }

  private async osmCategory(
    category: OsmCategoryId,
    here: { lat: number; lon: number },
    radius: number,
  ): Promise<{ places: RawPlace[]; source: SourceStatus }> {
    const centerLat = Math.round(here.lat / CELL_DEGREES) * CELL_DEGREES;
    const centerLon = Math.round(here.lon / CELL_DEGREES) * CELL_DEGREES;
    const queryRadius = Math.ceil((radius + CELL_MARGIN_M) / 500) * 500;
    const key = `${category}|${centerLat.toFixed(2)}|${centerLon.toFixed(2)}|${queryRadius}`;
    const now = this.clock();
    const cached = this.readCache(key);
    if (cached && now - cached.fetched_at <= this.ttlMs)
      return {
        places: cached.places,
        source: {
          category,
          provider: "overpass",
          status: "cached",
          fetched_at: cached.fetched_at,
          truncated: cached.truncated || undefined,
        },
      };
    try {
      let pending = this.inflight.get(key);
      if (!pending) {
        pending = this.client
          .query(buildQuery(category, centerLat, centerLon, queryRadius))
          .finally(() => this.inflight.delete(key));
        this.inflight.set(key, pending);
      }
      const fresh = await pending;
      this.writeCache(key, category, fresh, now);
      return {
        places: fresh.places,
        source: {
          category,
          provider: "overpass",
          status: "fresh",
          fetched_at: now,
          truncated: fresh.truncated || undefined,
        },
      };
    } catch (error) {
      const code =
        error instanceof OverpassError ? error.code : "PROVIDER_UNAVAILABLE";
      // Old data is better than none, but it is labelled stale and dated.
      if (cached && now - cached.fetched_at <= this.staleMs)
        return {
          places: cached.places,
          source: {
            category,
            provider: "overpass",
            status: "stale",
            fetched_at: cached.fetched_at,
            truncated: cached.truncated || undefined,
            error: code,
          },
        };
      return {
        places: [],
        source: {
          category,
          provider: "overpass",
          status: "failed",
          fetched_at: null,
          error: code,
        },
      };
    }
  }

  private readCache(key: string): CachedEntry | null {
    const row = this.db
      .prepare(
        "SELECT payload,truncated,fetched_at FROM places_cache WHERE key=?",
      )
      .get(key) as
      { payload: string; truncated: number; fetched_at: number } | undefined;
    if (!row) return null;
    try {
      return {
        places: JSON.parse(row.payload) as RawPlace[],
        truncated: !!row.truncated,
        fetched_at: row.fetched_at,
      };
    } catch {
      return null;
    }
  }
  private writeCache(
    key: string,
    category: string,
    value: { places: RawPlace[]; truncated: boolean },
    now: number,
  ) {
    this.db
      .prepare(
        `INSERT INTO places_cache(key,category,payload,truncated,fetched_at) VALUES(?,?,?,?,?)
         ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,truncated=excluded.truncated,fetched_at=excluded.fetched_at`,
      )
      .run(key, category, JSON.stringify(value.places), +value.truncated, now);
  }

  private safeHavens(
    here: { lat: number; lon: number },
    radius: number,
    demo: boolean,
  ): Place[] {
    const box = boundingBox(here, radius);
    const rows = this.db
      .prepare(
        `SELECT id,name,kind,latitude,longitude,address,phone,hours,source,verification_method,verified_at
         FROM safe_havens
         WHERE status='verified' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
           AND (source != 'demo' OR ?=1)`,
      )
      .all(box.minLat, box.maxLat, box.minLon, box.maxLon, +demo) as {
      id: string;
      name: string;
      kind: string;
      latitude: number;
      longitude: number;
      address: string | null;
      phone: string | null;
      hours: string | null;
      source: "participant" | "campus" | "demo";
      verification_method: string;
      verified_at: number;
    }[];
    return rows
      .map((r) => ({
        r,
        d: haversineMeters(here, { lat: r.latitude, lon: r.longitude }),
      }))
      .filter(({ d }) => d <= radius)
      .sort((a, b) => a.d - b.d || a.r.id.localeCompare(b.r.id))
      .map(({ r, d }): Place => ({
        id: `sakhi:${r.id}`,
        category: "safe_haven",
        name: r.name,
        lat: r.latitude,
        lon: r.longitude,
        distance_m: Math.round(d),
        address: r.address,
        phone: r.phone,
        opening_hours: r.hours,
        last_confirmed: new Date(r.verified_at).toISOString().slice(0, 10),
        source: r.source === "demo" ? "demo" : "sakhi_safe_haven",
        source_url: null,
        verified: r.source !== "demo",
        verification_note:
          r.source === "demo"
            ? "Demonstration entry — not a real participating location."
            : `Verified: ${r.verification_method}`,
      }));
  }
}
