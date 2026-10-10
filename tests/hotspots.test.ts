import { describe, expect, it } from "vitest";
import {
  allHotspots,
  hotspotChats,
  sentimentOf,
  heatColour,
} from "@/lib/hotspots";
import { servicesNear } from "@/lib/services";

describe("demo hotspots", () => {
  const all = allHotspots();

  it("covers 50 areas with ratings in 1–5 across all three tones", () => {
    expect(all).toHaveLength(50);
    for (const h of all) {
      expect(h.rating).toBeGreaterThanOrEqual(1);
      expect(h.rating).toBeLessThanOrEqual(5);
      expect(h.description.length).toBeGreaterThan(20);
      expect(h.description.length).toBeLessThan(140);
    }
    expect(new Set(all.map((h) => h.tone))).toEqual(
      new Set(["safer", "mixed", "caution"]),
    );
  });

  it("scores worried chat lower than reassuring chat", () => {
    expect(sentimentOf("Well lit, police patrol, felt safe")).toBeGreaterThan(
      0,
    );
    expect(sentimentOf("Dark lane, someone followed me, unsafe")).toBeLessThan(
      0,
    );
  });

  it("gives every area a synthetic conversation, and lower ratings read as more concern", () => {
    for (const h of all) expect(hotspotChats(h.id).length).toBe(h.chat_count);
    const worst = all.reduce((a, b) => (a.rating < b.rating ? a : b));
    const best = all.reduce((a, b) => (a.rating > b.rating ? a : b));
    expect(worst.risk).toBeGreaterThan(best.risk);
    expect(heatColour(worst.risk)).not.toBe(heatColour(best.risk));
  });

  it("finds emergency services and safe zones within 12 km of every area", () => {
    for (const h of all) {
      const found = servicesNear(h, 12_000);
      const has = (c: string) => found.some((s) => s.category === c);
      expect(has("police"), h.id).toBe(true);
      expect(has("hospital"), h.id).toBe(true);
      expect(has("women_help") && has("safe_zone"), h.id).toBe(true);
    }
  });

  it("respects the radius and labels generated records as synthetic", () => {
    const a = all.find((h) => h.id === "bengaluru-koramangala")!;
    const near = servicesNear(a, 1000);
    const wide = servicesNear(a, 8000);
    expect(near.every((s) => s.distance_m <= 1000)).toBe(true);
    expect(wide.length).toBeGreaterThan(near.length);
    expect(
      wide.filter((s) => s.synthetic).every((s) => s.id.startsWith("demo:")),
    ).toBe(true);
    expect(wide.some((s) => !s.synthetic && s.category === "police")).toBe(
      true,
    );
    for (let i = 1; i < wide.length; i++)
      expect(wide[i].distance_m).toBeGreaterThanOrEqual(wide[i - 1].distance_m);
  });
});
