// Pure trip helpers shared by the planner API and the trip page.
import {
  distanceToPolylineMeters,
  haversineMeters,
  type LatLon,
} from "@/lib/geo";

export type TravelMode = "walk" | "cab" | "bus" | "metro";
export type Companions = "alone" | "friend" | "group";
export type RouteTag = "safest" | "fastest" | "shortest";

export type PlannedRoute = {
  id: string;
  tags: RouteTag[];
  distance_m: number;
  /** Driving time from OSRM; use etaMinutes() for the chosen mode. */
  duration_s: number;
  geometry: [number, number][];
  /** 0–100, demo score from area ratings and nearby help. Not a prediction. */
  safety: number;
  help_points: number;
  /** Average rating (1–5) of the demo areas the route passes through. */
  area_rating: number;
  via: string | null;
};
export type TripPlan = { routes: PlannedRoute[]; notes: string[] };

export const MODES: { id: TravelMode; label: string }[] = [
  { id: "walk", label: "Walk" },
  { id: "cab", label: "Cab" },
  { id: "bus", label: "Bus" },
  { id: "metro", label: "Metro" },
];
export const TAG_LABEL: Record<RouteTag, string> = {
  safest: "Safest",
  fastest: "Fastest",
  shortest: "Shortest",
};

/** Rough door-to-door minutes by mode. OSRM only provides road driving times. */
export function etaMinutes(
  mode: TravelMode,
  r: Pick<PlannedRoute, "distance_m" | "duration_s">,
) {
  const km = r.distance_m / 1000;
  const minutes =
    mode === "walk"
      ? (km / 4.8) * 60
      : mode === "bus"
        ? 6 + (km / 16) * 60
        : mode === "metro"
          ? 8 + (km / 30) * 60
          : r.duration_s / 60;
  return Math.max(1, Math.round(minutes));
}

/** Score tweaks the traveller can see: company and time of day. */
export function adjustSafety(
  base: number,
  companions: Companions,
  arrivalHour: number,
) {
  const company = { alone: 0, friend: 4, group: 8 }[companions];
  const night = arrivalHour >= 20 || arrivalHour < 5 ? -6 : 0;
  return Math.max(10, Math.min(99, Math.round(base + company + night)));
}

export type RiskPoint = LatLon & { risk: number; rating: number };

function sample(line: [number, number][], max: number) {
  if (line.length <= max) return line;
  const step = (line.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => line[Math.round(i * step)]);
}

/**
 * Safety of a route from the demo area ratings it passes (inverse-distance weighted)
 * plus help points close to it. Demo scoring: hand-set, not validated.
 */
export function scoreRoute(
  line: [number, number][],
  areas: RiskPoint[],
  help: LatLon[],
) {
  const pts = sample(line, 120);
  let risk = 0;
  let rating = 0;
  for (const [lat, lon] of pts) {
    let w = 0;
    let r = 0;
    let q = 0;
    for (const a of areas) {
      const d = haversineMeters({ lat, lon }, a);
      if (d > 6000) continue;
      const k = 1 / (400 + d) ** 2;
      w += k;
      r += k * a.risk;
      q += k * a.rating;
    }
    risk += w ? r / w : 0.45;
    rating += w ? q / w : 3;
  }
  const avgRisk = risk / pts.length;
  const avgRating = rating / pts.length;
  const line2 = pts.map(([lat, lon]) => ({ lat, lon }));
  const near = help.filter((h) => distanceToPolylineMeters(h, line2) <= 250);
  const bonus = Math.min(12, near.length * 3);
  return {
    safety: Math.max(15, Math.min(98, Math.round(100 - 75 * avgRisk + bonus))),
    help_points: near.length,
    area_rating: Number(avgRating.toFixed(1)),
  };
}

/** Give each route the tags it earns; every tag lands on exactly one route. */
export function tagRoutes<T extends Omit<PlannedRoute, "tags">>(routes: T[]) {
  const best = (f: (r: T) => number) =>
    routes.reduce((a, b) => (f(b) < f(a) ? b : a), routes[0]);
  const safest = best((r) => -r.safety * 1e6 + r.duration_s);
  const fastest = best((r) => r.duration_s);
  const shortest = best((r) => r.distance_m);
  return routes
    .map((r) => ({
      ...r,
      tags: [
        r === safest && "safest",
        r === fastest && "fastest",
        r === shortest && "shortest",
      ].filter(Boolean) as RouteTag[],
    }))
    .sort(
      (a, b) =>
        +b.tags.includes("safest") - +a.tags.includes("safest") ||
        a.duration_s - b.duration_s,
    );
}
