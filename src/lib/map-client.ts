import { apiRequest } from "@/lib/api-client";
import type { PlaceCategoryId, PlacesResult } from "@/lib/places-types";
import type { AreaSignals, PublicReport } from "@/lib/safety-types";

export type Point = { lat: number; lon: number };
export type RouteOption = {
  index: number;
  distance_m: number;
  duration_s: number;
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

// Starting points for people who prefer not to share a device location.
export const CITY_CENTRES: { name: string; lat: number; lon: number }[] = [
  { name: "Delhi", lat: 28.6139, lon: 77.209 },
  { name: "Mumbai", lat: 19.076, lon: 72.8777 },
  { name: "Bengaluru", lat: 12.9716, lon: 77.5946 },
  { name: "Kolkata", lat: 22.5726, lon: 88.3639 },
  { name: "Chennai", lat: 13.0827, lon: 80.2707 },
  { name: "Hyderabad", lat: 17.385, lon: 78.4867 },
  { name: "Jaipur", lat: 26.9124, lon: 75.7873 },
  { name: "Bhopal", lat: 23.2599, lon: 77.4126 },
  { name: "Lucknow", lat: 26.8467, lon: 80.9462 },
  { name: "Patna", lat: 25.5941, lon: 85.1376 },
];

const qs = (params: Record<string, string | number | boolean | undefined>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== false)
      .map(([k, v]) => [k, v === true ? "1" : String(v)]),
  ).toString();

export const fetchNearby = (
  p: Point,
  categories: PlaceCategoryId[],
  radius_m: number,
  include_demo: boolean,
) =>
  apiRequest<PlacesResult>(
    `/api/places/nearby?${qs({ lat: p.lat, lon: p.lon, radius_m, categories: categories.join(","), include_demo })}`,
  );
export const fetchReports = (
  p: Point,
  radius_m: number,
  since_days: number,
  include_demo: boolean,
) =>
  apiRequest<{ reports: PublicReport[]; includes_demo: boolean }>(
    `/api/reports?${qs({ lat: p.lat, lon: p.lon, radius_m, since_days, include_demo })}`,
  );
export const fetchAreaSummary = (
  p: Point,
  since_days: number,
  include_demo: boolean,
) =>
  apiRequest<AreaSignals>(
    `/api/areas/summary?${qs({ lat: p.lat, lon: p.lon, since_days, include_demo })}`,
  );
export const compareRoutes = (from: Point, to: Point, include_demo: boolean) =>
  apiRequest<RouteComparison>("/api/routes/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Only coordinates cross the wire, never labels or other picker state.
    body: JSON.stringify({
      from: { lat: from.lat, lon: from.lon },
      to: { lat: to.lat, lon: to.lon },
      include_demo,
    }),
  });
export const submitReport = (input: Record<string, unknown>) =>
  apiRequest<PublicReport>("/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export function formatDistance(m: number) {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}
// Only digits, +, spaces, brackets, dots and hyphens may reach a tel: link.
export function telHref(raw: string | null) {
  if (!raw) return null;
  const first = raw.split(/[;,/]/)[0].trim();
  if (!/^\+?[\d][\d\s().-]{5,18}$/.test(first)) return null;
  return `tel:${first.replace(/[^\d+]/g, "")}`;
}
