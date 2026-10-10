import { describe, expect, it } from "vitest";
import {
  areaForPoint,
  areaFromId,
  boundingBox,
  distanceToPolylineMeters,
  haversineMeters,
} from "../src/lib/geo";

const delhi = { lat: 28.6139, lon: 77.209 };

describe("geo helpers", () => {
  it("computes great-circle distance", () => {
    expect(haversineMeters(delhi, delhi)).toBe(0);
    // Delhi (Connaught Place) to Mumbai is roughly 1,150 km.
    const km = haversineMeters(delhi, { lat: 19.076, lon: 72.8777 }) / 1000;
    expect(km).toBeGreaterThan(1130);
    expect(km).toBeLessThan(1170);
    // One degree of latitude ≈ 111.2 km.
    expect(haversineMeters({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(
      111_195,
      -2,
    );
  });

  it("bounding boxes contain every point within the radius", () => {
    const box = boundingBox(delhi, 1000);
    for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const b = (bearing * Math.PI) / 180;
      const p = {
        lat: delhi.lat + (999 / 111_320) * Math.cos(b),
        lon:
          delhi.lon +
          (999 / (111_320 * Math.cos((delhi.lat * Math.PI) / 180))) *
            Math.sin(b),
      };
      expect(p.lat).toBeGreaterThanOrEqual(box.minLat);
      expect(p.lat).toBeLessThanOrEqual(box.maxLat);
      expect(p.lon).toBeGreaterThanOrEqual(box.minLon);
      expect(p.lon).toBeLessThanOrEqual(box.maxLon);
    }
  });

  it("measures distance to a polyline, including beyond its ends", () => {
    const line = [
      { lat: 28.6, lon: 77.2 },
      { lat: 28.6, lon: 77.21 },
    ];
    // ~111 m north of the middle of the segment.
    expect(
      distanceToPolylineMeters({ lat: 28.601, lon: 77.205 }, line),
    ).toBeCloseTo(111, -1);
    // Past the end: distance to the endpoint, not the infinite line.
    const end = distanceToPolylineMeters({ lat: 28.6, lon: 77.22 }, line);
    expect(end).toBeCloseTo(
      haversineMeters({ lat: 28.6, lon: 77.21 }, { lat: 28.6, lon: 77.22 }),
      -1,
    );
    expect(distanceToPolylineMeters(delhi, [])).toBe(Infinity);
  });
});

describe("stable area grid", () => {
  it("assigns every point in a cell the same id and a center inside the cell", () => {
    const a = areaForPoint(28.6139, 77.209);
    const b = areaForPoint(a.center.lat, a.center.lon);
    expect(b.id).toBe(a.id);
    for (const [lat, lon] of [
      [a.bounds.minLat + 1e-9, a.bounds.minLon + 1e-9],
      [a.bounds.maxLat - 1e-9, a.bounds.maxLon - 1e-9],
    ])
      expect(areaForPoint(lat, lon).id).toBe(a.id);
    expect(areaForPoint(a.bounds.maxLat + 1e-6, a.center.lon).id).not.toBe(
      a.id,
    );
  });

  it("is about 500 m wide at Indian latitudes and deterministic", () => {
    for (const [lat, lon] of [
      [8.5, 76.9],
      [28.6, 77.2],
      [34.1, 74.8],
    ]) {
      const a = areaForPoint(lat, lon);
      expect(areaForPoint(lat, lon)).toEqual(a);
      const h = haversineMeters(
        { lat: a.bounds.minLat, lon: a.bounds.minLon },
        { lat: a.bounds.maxLat, lon: a.bounds.minLon },
      );
      const w = haversineMeters(
        { lat: a.center.lat, lon: a.bounds.minLon },
        { lat: a.center.lat, lon: a.bounds.maxLon },
      );
      expect(h).toBeGreaterThan(480);
      expect(h).toBeLessThan(520);
      expect(w).toBeGreaterThan(470);
      expect(w).toBeLessThan(530);
    }
  });

  it("round-trips ids and rejects malformed or out-of-range ones", () => {
    const a = areaForPoint(19.076, 72.8777);
    expect(areaFromId(a.id)).toEqual(a);
    for (const bad of [
      "",
      "g500",
      "g500:1",
      "x500:1:2",
      "g500:1:2:3",
      "g500:a:b",
      "g500:999999999:1",
    ])
      expect(areaFromId(bad)).toBeNull();
    expect(() => areaForPoint(91, 0)).toThrow(RangeError);
    expect(() => areaForPoint(NaN, 0)).toThrow(RangeError);
  });
});
