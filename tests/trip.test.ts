import { describe, expect, it } from "vitest";
import {
  adjustSafety,
  etaMinutes,
  scoreRoute,
  tagRoutes,
  type RiskPoint,
} from "@/lib/trip";

const line = (lat: number): [number, number][] =>
  Array.from({ length: 20 }, (_, i) => [lat, 77.6 + i * 0.002]);

describe("trip safety", () => {
  const calm: RiskPoint = { lat: 12.97, lon: 77.62, risk: 0.1, rating: 4.6 };
  const risky: RiskPoint = { lat: 13.0, lon: 77.62, risk: 0.9, rating: 1.4 };

  it("scores a route through calm areas above one through risky areas", () => {
    const a = scoreRoute(line(12.97), [calm, risky], []);
    const b = scoreRoute(line(13.0), [calm, risky], []);
    expect(a.safety).toBeGreaterThan(b.safety);
    expect(a.area_rating).toBeGreaterThan(b.area_rating);
  });

  it("adds a bonus for help points close to the route, and only those", () => {
    const bare = scoreRoute(line(12.97), [risky], []);
    const helped = scoreRoute(
      line(12.97),
      [risky],
      [
        { lat: 12.9702, lon: 77.62 },
        { lat: 12.9, lon: 77.62 },
      ],
    );
    expect(helped.help_points).toBe(1);
    expect(helped.safety).toBeGreaterThan(bare.safety);
  });

  it("estimates minutes per mode and adjusts for company and night", () => {
    const r = { distance_m: 4800, duration_s: 600 };
    expect(etaMinutes("walk", r)).toBe(60);
    expect(etaMinutes("cab", r)).toBe(10);
    expect(etaMinutes("metro", r)).toBeGreaterThan(8);
    expect(adjustSafety(70, "group", 12)).toBe(78);
    expect(adjustSafety(70, "alone", 22)).toBe(64);
  });

  it("tags each of safest, fastest and shortest once", () => {
    const base = { geometry: [], help_points: 0, area_rating: 3, via: null };
    const tagged = tagRoutes([
      { ...base, id: "a", distance_m: 5000, duration_s: 700, safety: 60 },
      { ...base, id: "b", distance_m: 6000, duration_s: 900, safety: 85 },
      { ...base, id: "c", distance_m: 4500, duration_s: 800, safety: 70 },
    ]);
    expect(tagged[0].id).toBe("b");
    expect(tagged[0].tags).toEqual(["safest"]);
    expect(tagged.find((r) => r.id === "a")!.tags).toEqual(["fastest"]);
    expect(tagged.find((r) => r.id === "c")!.tags).toEqual(["shortest"]);
  });
});
