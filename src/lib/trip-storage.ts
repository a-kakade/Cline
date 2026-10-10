import type { PlannedRoute, TravelMode } from "@/lib/trip";

// Route geometry isn't stored with a journey, so the trip screen keeps the chosen plan
// for this browser tab only, to redraw it after a reload. Nothing else uses it.
export type SavedTrip = {
  journeyId: string;
  mode: TravelMode;
  from: { lat: number; lon: number; label: string };
  to: { lat: number; lon: number; label: string };
  route: PlannedRoute;
  summary: string;
};
const KEY = "sakhi.trip.plan";

export function saveTrip(trip: SavedTrip) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(trip));
  } catch {
    /* Private mode or blocked storage: the trip still works, just without the saved line. */
  }
}
export function loadTrip(journeyId: string): SavedTrip | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const t = raw ? (JSON.parse(raw) as SavedTrip) : null;
    return t && t.journeyId === journeyId && Array.isArray(t.route?.geometry)
      ? t
      : null;
  } catch {
    return null;
  }
}
export function clearTrip() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
