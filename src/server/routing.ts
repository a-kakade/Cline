import type Database from "better-sqlite3";
import { z } from "zod";
import {
  boundingBox,
  distanceToPolylineMeters,
  haversineMeters,
  type LatLon,
} from "@/lib/geo";
import { throttle } from "./audit";
import { AppError } from "./http";
import { demoAllowed } from "./places/service";

const point = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  })
  .strict();
export const routeSchema = z
  .object({ from: point, to: point, include_demo: z.boolean().default(false) })
  .strict();

const NEAR_REPORT_M = 150;
const NEAR_HAVEN_M = 200;
const MAX_TRIP_M = 50_000;

export type RouteOption = {
  index: number;
  distance_m: number;
  duration_s: number;
  /** [lat, lon] pairs, thinned for display. */
  geometry: [number, number][];
  nearby: {
    unverified_reports: number;
    verified_reports: number;
    infrastructure_hazards: number;
    safe_havens: number;
    demo_reports_included: boolean;
  };
};
export type RouteComparison = {
  routes: RouteOption[];
  provider: { name: string; network: string; production_suitable: false };
  notes: string[];
};

const responseSchema = z.object({
  code: z.string(),
  routes: z
    .array(
      z.object({
        distance: z.number(),
        duration: z.number(),
        geometry: z.object({
          coordinates: z.array(
            z.tuple([z.number(), z.number()]).rest(z.number()),
          ),
        }),
      }),
    )
    .optional(),
});

export class RoutingService {
  constructor(
    private db: Database.Database,
    private fetchImpl: typeof fetch = fetch,
    private clock = Date.now,
    private baseUrl = process.env.OSRM_URL ?? "https://router.project-osrm.org",
    private timeoutMs = 10_000,
  ) {}

  async compare(userId: string, input: unknown): Promise<RouteComparison> {
    const data = routeSchema.parse(input);
    throttle(this.db, userId, "routes", 20, this.clock());
    if (haversineMeters(data.from, data.to) > MAX_TRIP_M)
      throw new AppError(
        400,
        "TOO_FAR",
        "Choose points within 50 km of each other.",
      );
    const url =
      `${this.baseUrl}/route/v1/driving/${data.from.lon.toFixed(5)},${data.from.lat.toFixed(5)};` +
      `${data.to.lon.toFixed(5)},${data.to.lat.toFixed(5)}?alternatives=true&overview=full&geometries=geojson&steps=false`;
    let body: unknown;
    try {
      const response = await this.fetchImpl(url, {
        headers: {
          "user-agent": process.env.OVERPASS_USER_AGENT ?? "SakhiSafetyApp/0.1",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error(String(response.status));
      body = await response.json();
    } catch {
      throw new AppError(
        503,
        "ROUTING_UNAVAILABLE",
        "Route comparison is unavailable right now. Nearby services and emergency calling are unaffected.",
      );
    }
    const parsed = responseSchema.safeParse(body);
    if (
      !parsed.success ||
      parsed.data.code !== "Ok" ||
      !parsed.data.routes?.length
    )
      throw new AppError(
        404,
        "NO_ROUTE",
        "No road route was found between these points.",
      );
    const demo = data.include_demo && demoAllowed();
    const routes = parsed.data.routes
      .slice(0, 3)
      .map((r, index): RouteOption => {
        const line: LatLon[] = r.geometry.coordinates.map(([lon, lat]) => ({
          lat,
          lon,
        }));
        return {
          index,
          distance_m: Math.round(r.distance),
          duration_s: Math.round(r.duration),
          geometry: thin(line, 400).map((p) => [p.lat, p.lon]),
          nearby: this.along(line, demo),
        };
      });
    return {
      routes,
      provider: {
        name: "OSRM public demo server",
        network: "vehicle road network",
        production_suitable: false,
      },
      notes: [
        "These are road routes for vehicles, not walking routes: the public demo server returns the same result for every travel mode.",
        "Durations are vehicle estimates and ignore traffic.",
        "Counts show reports and verified Safe Havens close to each route. They describe data, not how safe a route is; routes with fewer reports may simply have fewer reporters.",
        "Both route points are sent to the routing provider to compute the route.",
      ],
    };
  }

  private along(line: LatLon[], demo: boolean): RouteOption["nearby"] {
    const empty = {
      unverified_reports: 0,
      verified_reports: 0,
      infrastructure_hazards: 0,
      safe_havens: 0,
      demo_reports_included: demo,
    };
    if (!line.length) return empty;
    const lats = line.map((p) => p.lat);
    const lons = line.map((p) => p.lon);
    const mid = {
      lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      lon: (Math.min(...lons) + Math.max(...lons)) / 2,
    };
    const half = Math.max(
      haversineMeters(mid, { lat: Math.max(...lats), lon: mid.lon }),
      haversineMeters(mid, { lat: mid.lat, lon: Math.max(...lons) }),
    );
    const box = boundingBox(mid, half + 300);
    const reports = this.db
      .prepare(
        `SELECT kind,verification,latitude,longitude FROM reports
         WHERE status='visible' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
           AND COALESCE(occurred_at,created_at) >= ? AND (source != 'synthetic_demo' OR ?=1) LIMIT 5000`,
      )
      .all(
        box.minLat,
        box.maxLat,
        box.minLon,
        box.maxLon,
        this.clock() - 90 * 86_400_000,
        +demo,
      ) as {
      kind: string;
      verification: string;
      latitude: number;
      longitude: number;
    }[];
    const result = { ...empty };
    const sample = thin(line, 1500);
    for (const r of reports) {
      if (
        distanceToPolylineMeters(
          { lat: r.latitude, lon: r.longitude },
          sample,
        ) > NEAR_REPORT_M
      )
        continue;
      if (r.kind === "infrastructure_hazard") result.infrastructure_hazards++;
      else if (r.verification === "verified") result.verified_reports++;
      else result.unverified_reports++;
    }
    const havens = this.db
      .prepare(
        `SELECT latitude,longitude FROM safe_havens WHERE status='verified' AND source != 'demo'
           AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?`,
      )
      .all(box.minLat, box.maxLat, box.minLon, box.maxLon) as {
      latitude: number;
      longitude: number;
    }[];
    result.safe_havens = havens.filter(
      (h) =>
        distanceToPolylineMeters(
          { lat: h.latitude, lon: h.longitude },
          sample,
        ) <= NEAR_HAVEN_M,
    ).length;
    return result;
  }
}

function thin(line: LatLon[], max: number): LatLon[] {
  if (line.length <= max) return line;
  const step = (line.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => line[Math.round(i * step)]);
}
