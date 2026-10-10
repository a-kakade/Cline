import type Database from "better-sqlite3";
import { z } from "zod";
import { haversineMeters, type LatLon } from "@/lib/geo";
import { allHotspots } from "@/lib/hotspots";
import { servicesNear } from "@/lib/services";
import {
  scoreRoute,
  tagRoutes,
  type PlannedRoute,
  type TripPlan,
} from "@/lib/trip";
import { throttle } from "./audit";
import { AppError } from "./http";

const point = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  })
  .strict();
export const planSchema = z.object({ from: point, to: point }).strict();

const MAX_TRIP_M = 50_000;
const osrmSchema = z.object({
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
type Raw = { distance: number; duration: number; line: [number, number][] };

// Help points a route can pass: places with staff, lights or other people around.
const HELP = new Set(["police", "women_help", "safe_zone", "transit"]);

export class TripService {
  constructor(
    private db: Database.Database,
    private fetchImpl: typeof fetch = fetch,
    private clock = Date.now,
    private baseUrl = process.env.OSRM_URL ?? "https://router.project-osrm.org",
    private timeoutMs = 10_000,
  ) {}

  private async osrm(stops: LatLon[], alternatives: boolean): Promise<Raw[]> {
    const path = stops
      .map((s) => `${s.lon.toFixed(5)},${s.lat.toFixed(5)}`)
      .join(";");
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/route/v1/driving/${path}?alternatives=${alternatives}&overview=full&geometries=geojson&steps=false`,
        {
          headers: {
            "user-agent":
              process.env.OVERPASS_USER_AGENT ?? "SakhiSafetyApp/0.1",
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
      if (!response.ok) throw new Error(String(response.status));
      const parsed = osrmSchema.parse(await response.json());
      if (parsed.code !== "Ok" || !parsed.routes?.length) return [];
      return parsed.routes.slice(0, 3).map((r) => ({
        distance: r.distance,
        duration: r.duration,
        line: r.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
      }));
    } catch {
      throw new AppError(
        503,
        "ROUTING_UNAVAILABLE",
        "Route planning is unavailable right now. Emergency calling is unaffected.",
      );
    }
  }

  async plan(userId: string, input: unknown): Promise<TripPlan> {
    const { from, to } = planSchema.parse(input);
    throttle(this.db, userId, "trip-plan", 20, this.clock());
    const crow = haversineMeters(from, to);
    if (crow > MAX_TRIP_M)
      throw new AppError(
        400,
        "TOO_FAR",
        "Choose places within 50 km of each other.",
      );
    if (crow < 150)
      throw new AppError(
        400,
        "TOO_CLOSE",
        "Start and destination are almost the same place.",
      );

    const mid = { lat: (from.lat + to.lat) / 2, lon: (from.lon + to.lon) / 2 };
    const near = servicesNear(mid, Math.min(12_000, crow / 2 + 2000), {
      cap: false,
    });
    const help = near.filter((s) => HELP.has(s.category));
    // Well-staffed stops close to the straight line: a short detour through one gives a
    // route with somewhere to go for help. Up to two, on different stretches.
    const vias: typeof help = [];
    for (const c of help
      .map((s) => ({
        s,
        detour: haversineMeters(from, s) + haversineMeters(s, to) - crow,
      }))
      .filter((c) => c.detour < crow * 0.35 && c.detour > 0)
      .sort((a, b) => a.detour - b.detour)) {
      if (vias.every((v) => haversineMeters(v, c.s) > Math.max(800, crow / 4)))
        vias.push(c.s);
      if (vias.length === 2) break;
    }

    const [direct, ...viaSets] = await Promise.all([
      this.osrm([from, to], true),
      ...vias.map((v) => this.osrm([from, v, to], false).catch(() => [])),
    ]);
    if (!direct.length)
      throw new AppError(
        404,
        "NO_ROUTE",
        "No road route was found between these places.",
      );

    const raws: (Raw & { via: string | null })[] = [
      ...direct.map((r) => ({ ...r, via: null })),
      ...viaSets.flatMap((set, i) =>
        set.map((r) => ({ ...r, via: vias[i].name })),
      ),
    ];
    // Drop near-duplicates (alternatives that are the same road).
    const unique = raws.filter(
      (r, i) =>
        !raws
          .slice(0, i)
          .some(
            (o) =>
              Math.abs(o.distance - r.distance) / r.distance < 0.02 &&
              Math.abs(o.duration - r.duration) / r.duration < 0.03,
          ),
    );
    const areas = allHotspots().map((h) => ({
      lat: h.lat,
      lon: h.lon,
      risk: h.risk,
      rating: h.rating,
    }));
    const scored = unique
      .slice(0, 3)
      .map((r, i): Omit<PlannedRoute, "tags"> => ({
        id: `r${i + 1}`,
        distance_m: Math.round(r.distance),
        duration_s: Math.round(r.duration),
        geometry: thin(r.line, 300),
        via: r.via,
        ...scoreRoute(r.line, areas, help),
      }));
    return {
      routes: tagRoutes(scored),
      notes: [
        "Safety scores are a demo estimate from synthetic area ratings and nearby help points. They are not a prediction and not a promise.",
        "Road routes come from the OSRM demo server and follow the vehicle network. Walk, bus and metro times are rough estimates from distance.",
      ],
    };
  }
}

function thin<T>(line: T[], max: number): T[] {
  if (line.length <= max) return line;
  const step = (line.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => line[Math.round(i * step)]);
}
