import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import {
  buildQuery,
  ELEMENT_LIMIT,
  OverpassClient,
  OverpassError,
  parseElements,
} from "../src/server/places/overpass";
import { PlacesService } from "../src/server/places/service";
import { createAuthFixture, signUp, type AuthFixture } from "./helpers";

const fixtureJson = JSON.parse(
  readFileSync(
    new URL("./fixtures/overpass-delhi-police-hospital.json", import.meta.url),
    "utf8",
  ),
);
const DELHI = { lat: 28.6139, lon: 77.209 };
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

const reply = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
  });
const node = (
  id: number,
  lat: number,
  lon: number,
  tags: Record<string, string> = {},
) => ({
  type: "node",
  id,
  lat,
  lon,
  tags,
});
const metersNorth = (m: number) => DELHI.lat + m / 111_194.9266;

describe("Overpass parsing against a real recorded response", () => {
  it("keeps what is mapped and leaves everything else null", () => {
    const { places, truncated, remark } = parseElements(fixtureJson);
    expect(places).toHaveLength(7);
    expect(truncated).toBe(false);
    expect(remark).toBeNull();
    const byId = Object.fromEntries(places.map((p) => [p.id, p]));
    const way = byId["osm:way/34404757"]; // a way is located by its centre
    expect(way.name).toMatch(/Hospital/);
    expect(way.phone).not.toBeNull();
    expect(way.source_url).toBe("https://www.openstreetmap.org/way/34404757");
    for (const p of places) {
      expect(p.opening_hours).toBeNull(); // no mapped hours in this sample: never inferred
      expect(p.lat).toBeGreaterThan(28);
      expect(p.lon).toBeGreaterThan(77);
    }
    expect(places.filter((p) => p.name === null).length).toBeGreaterThan(0);
    expect(places.filter((p) => p.phone === null).length).toBeGreaterThan(3);
  });

  it("skips malformed elements, strips control characters and builds addresses only from tags", () => {
    const { places } = parseElements({
      elements: [
        node(1, 28.6, 77.2, {
          name: "Ward\u0000 One\nPharmacy",
          "addr:housenumber": "12",
          "addr:street": "Main Rd",
          "addr:city": "Delhi",
          "contact:phone": "+91 11 2345 6789",
          check_date: "2025-03-01",
        }),
        { type: "node", id: 2, lat: 95, lon: 10, tags: {} }, // impossible latitude
        { type: "node", id: 3, tags: {} }, // no position
        { type: "bogus", id: 4 },
        "not an element",
        { type: "way", id: 5, center: { lat: 28.7, lon: 77.1 } },
      ],
    });
    expect(places.map((p) => p.id)).toEqual(["osm:node/1", "osm:way/5"]);
    expect(places[0]).toMatchObject({
      name: "Ward One Pharmacy",
      address: "12 Main Rd, Delhi",
      phone: "+91 11 2345 6789",
      last_confirmed: "2025-03-01",
    });
    expect(places[1]).toMatchObject({ name: null, address: null, phone: null });
  });

  it("flags a possibly truncated result and rejects a non-Overpass body", () => {
    const many = Array.from({ length: ELEMENT_LIMIT }, (_, i) =>
      node(i + 1, 28.6, 77.2),
    );
    expect(parseElements({ elements: many }).truncated).toBe(true);
    expect(() => parseElements({ nope: true })).toThrow(OverpassError);
    expect(() => parseElements(null)).toThrow(
      expect.objectContaining({ code: "PROVIDER_INVALID" }),
    );
  });

  it("builds a bounded query per category", () => {
    const q = buildQuery("help_point", 28.61, 77.21, 1500);
    expect(q).toContain("[timeout:15]");
    expect(q).toContain(
      'nwr["emergency"="phone"](around:1500,28.61000,77.21000)',
    );
    expect(q).toContain('nwr["amenity"="help_point"]');
    expect(q).toContain(`out tags center ${ELEMENT_LIMIT}`);
    expect(buildQuery("police", 1, 2, 999.6)).toContain("around:1000");
  });
});

describe("OverpassClient failure handling", () => {
  const make = (fetchImpl: typeof fetch, extra = {}) =>
    new OverpassClient({
      endpoints: ["https://a.test/i", "https://b.test/i"],
      fetch: fetchImpl,
      minIntervalMs: 0,
      userAgent: "SakhiTest/1.0",
      ...extra,
    });

  it("identifies itself, posts the query and returns parsed places", async () => {
    const fetchMock = vi.fn(async () =>
      reply({ elements: [node(1, 28.6, 77.2, { name: "A" })] }),
    );
    const result = await make(fetchMock as never).query("QL");
    expect(result.places).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://a.test/i");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["user-agent"]).toBe(
      "SakhiTest/1.0",
    );
    expect(String(init.body)).toBe("data=QL");
  });

  it.each([
    [429, "PROVIDER_RATE_LIMITED"],
    [504, "PROVIDER_TIMEOUT"],
    [500, "PROVIDER_ERROR"],
  ])(
    "falls back to the mirror after HTTP %i and reports %s if both fail",
    async (status, code) => {
      const fetchMock = vi.fn(async (url: string) =>
        url.startsWith("https://a.test")
          ? reply("busy", status)
          : reply({ elements: [node(7, 28.6, 77.2)] }),
      );
      expect((await make(fetchMock as never).query("QL")).places).toHaveLength(
        1,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const failing = vi.fn(async () => reply("busy", status));
      await expect(make(failing as never).query("QL")).rejects.toMatchObject({
        code,
      });
      expect(failing).toHaveBeenCalledTimes(2);
    },
  );

  it("does not retry a rejected (HTTP 400) query on the mirror", async () => {
    const fetchMock = vi.fn(async () => reply("bad query", 400));
    await expect(make(fetchMock as never).query("QL")).rejects.toMatchObject({
      code: "PROVIDER_INVALID",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps network failures, aborts and invalid JSON to stable error codes", async () => {
    const network = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(make(network as never).query("QL")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    const aborted = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await expect(make(aborted as never).query("QL")).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
    });
    const html = vi.fn(async () => reply("<html>not json</html>"));
    await expect(make(html as never).query("QL")).rejects.toMatchObject({
      code: "PROVIDER_INVALID",
    });
  });

  it("treats a 200 response carrying a runtime-error remark as a failure", async () => {
    const partial = vi.fn(async () =>
      reply({
        remark: 'runtime error: Query timed out in "query"',
        elements: [node(1, 28.6, 77.2)],
      }),
    );
    await expect(make(partial as never).query("QL")).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
    });
  });

  it("serialises and paces concurrent upstream calls", async () => {
    let now = 1000;
    const sleeps: number[] = [];
    const order: string[] = [];
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      order.push(String(init.body));
      return reply({ elements: [] });
    });
    const client = make(fetchMock as never, {
      minIntervalMs: 1000,
      clock: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
    });
    await Promise.all([
      client.query("one"),
      client.query("two"),
      client.query("three"),
    ]);
    expect(order).toEqual(["data=one", "data=two", "data=three"]);
    expect(sleeps).toEqual([1000, 1000]);
  });
});

describe("PlacesService with real SQLite", () => {
  let fixture: AuthFixture;
  let now: number;

  beforeEach(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(48).toString("base64url"));
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    fixture = await createAuthFixture();
    now = NOW;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fixture?.close();
  });

  function service(
    fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
  ) {
    const client = new OverpassClient({
      endpoints: ["https://a.test/i"],
      fetch: fetchImpl as never,
      minIntervalMs: 0,
    });
    return new PlacesService(fixture.db, client, () => now);
  }
  const bodyOf = (init: RequestInit) =>
    decodeURIComponent(String(init.body).replace(/\+/g, " "));

  it("returns results nearest-first within the radius, with only mapped details", async () => {
    const user = await signUp(fixture);
    const svc = service(async () =>
      reply({
        elements: [
          node(3, metersNorth(900), DELHI.lon, { name: "Far Station" }),
          node(1, metersNorth(100), DELHI.lon, {
            name: "Near Station",
            phone: "112",
          }),
          node(2, metersNorth(500), DELHI.lon, {}),
          node(4, metersNorth(2500), DELHI.lon, { name: "Out of range" }),
        ],
      }),
    );
    const result = await svc.nearby(user.id, {
      ...DELHI,
      radius_m: 1000,
      categories: ["police"],
    });
    expect(result.places.map((p) => [p.id, p.distance_m])).toEqual([
      ["osm:node/1", 100],
      ["osm:node/2", 500],
      ["osm:node/3", 900],
    ]);
    expect(result.places[1]).toMatchObject({
      name: null,
      phone: null,
      address: null,
      opening_hours: null,
    });
    expect(
      result.places.every((p) => p.source === "osm" && p.verified === false),
    ).toBe(true);
    expect(result.attribution).toContain("OpenStreetMap");
    expect(result.sources).toEqual([
      expect.objectContaining({
        category: "police",
        provider: "overpass",
        status: "fresh",
        fetched_at: NOW,
      }),
    ]);
  });

  it("never sends the user's exact position upstream and covers the whole search circle", async () => {
    const user = await signUp(fixture);
    const seen: string[] = [];
    const svc = service(
      async (_u, init) => (seen.push(bodyOf(init)), reply({ elements: [] })),
    );
    await svc.nearby(user.id, {
      lat: 28.61393,
      lon: 77.20907,
      radius_m: 1000,
      categories: ["pharmacy"],
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain("28.61393");
    expect(seen[0]).not.toContain("77.20907");
    expect(seen[0]).toContain("28.61000,77.21000");
    const radius = Number(/around:(\d+)/.exec(seen[0])![1]);
    expect(radius).toBeGreaterThanOrEqual(1000 + 780); // true radius + worst-case grid offset
  });

  it("caches per area, expires after the TTL and coalesces concurrent identical requests", async () => {
    const user = await signUp(fixture);
    let calls = 0;
    const svc = service(
      async () => (
        calls++,
        reply({ elements: [node(1, metersNorth(50), DELHI.lon)] })
      ),
    );
    const input = { ...DELHI, categories: ["hospital"] };
    await Promise.all([
      svc.nearby(user.id, input),
      svc.nearby(user.id, input),
      svc.nearby(user.id, input),
    ]);
    expect(calls).toBe(1);
    const again = await svc.nearby(user.id, {
      ...input,
      lat: DELHI.lat + 0.001,
    });
    expect(again.sources[0]).toMatchObject({
      status: "cached",
      fetched_at: NOW,
    });
    expect(calls).toBe(1);
    now += DAY + 1;
    const refreshed = await svc.nearby(user.id, input);
    expect(refreshed.sources[0]).toMatchObject({
      status: "fresh",
      fetched_at: now,
    });
    expect(calls).toBe(2);
  });

  it("serves old data labelled stale when the provider fails, and reports failure when there is none", async () => {
    const user = await signUp(fixture);
    let healthy = true;
    const svc = service(async () =>
      healthy
        ? reply({
            elements: [
              node(1, metersNorth(50), DELHI.lon, { name: "Cached Clinic" }),
            ],
          })
        : reply("down", 504),
    );
    const input = { ...DELHI, categories: ["hospital"] };
    await svc.nearby(user.id, input);
    healthy = false;
    now += 2 * DAY;
    const stale = await svc.nearby(user.id, input);
    expect(stale.sources[0]).toMatchObject({
      status: "stale",
      error: "PROVIDER_TIMEOUT",
      fetched_at: NOW,
    });
    expect(stale.places.map((p) => p.name)).toEqual(["Cached Clinic"]);
    now += 10 * DAY; // beyond the stale limit
    const failed = await svc.nearby(user.id, input);
    expect(failed.places).toEqual([]);
    expect(failed.sources[0]).toMatchObject({
      status: "failed",
      error: "PROVIDER_TIMEOUT",
      fetched_at: null,
    });
    const fresh = await svc.nearby(user.id, {
      ...input,
      lat: 12.97,
      lon: 77.59,
    });
    expect(fresh.sources[0].status).toBe("failed");
  });

  it("isolates failures per category", async () => {
    const user = await signUp(fixture);
    const svc = service(async (_u, init) =>
      bodyOf(init).includes('"police"')
        ? reply("busy", 429)
        : reply({
            elements: [
              node(9, metersNorth(80), DELHI.lon, { name: "Chemist" }),
            ],
          }),
    );
    const result = await svc.nearby(user.id, {
      ...DELHI,
      categories: ["police", "pharmacy"],
    });
    expect(result.sources.map((s) => [s.category, s.status, s.error])).toEqual([
      ["police", "failed", "PROVIDER_RATE_LIMITED"],
      ["pharmacy", "fresh", undefined],
    ]);
    expect(result.places.map((p) => p.name)).toEqual(["Chemist"]);
  });

  it("returns an honest empty result and caps radius per category", async () => {
    const user = await signUp(fixture);
    const radii: number[] = [];
    const svc = service(
      async (_u, init) => (
        radii.push(Number(/around:(\d+)/.exec(bodyOf(init))![1])),
        reply({ elements: [] })
      ),
    );
    const result = await svc.nearby(user.id, {
      ...DELHI,
      radius_m: 10_000,
      categories: ["bus_stop"],
    });
    expect(result.places).toEqual([]);
    expect(result.sources[0]).toMatchObject({ status: "fresh" });
    expect(radii[0]).toBeLessThanOrEqual(1500 + 800 + 500); // bus stops are capped at 1.5 km
  });

  it("limits results per category and validates input", async () => {
    const user = await signUp(fixture);
    const svc = service(async () =>
      reply({
        elements: Array.from({ length: 30 }, (_, i) =>
          node(i + 1, metersNorth(10 * (i + 1)), DELHI.lon),
        ),
      }),
    );
    const result = await svc.nearby(user.id, {
      ...DELHI,
      categories: ["toilets"],
      per_category: 5,
    });
    expect(result.places).toHaveLength(5);
    for (const bad of [
      { lat: 91, lon: 0 },
      { lat: 0, lon: 181 },
      { ...DELHI, radius_m: 50 },
      { ...DELHI, categories: ["casino"] },
      { ...DELHI, categories: [] },
      { ...DELHI, extra: 1 },
    ])
      await expect(svc.nearby(user.id, bad)).rejects.toThrow(ZodError);
  });

  it("rate-limits per user", async () => {
    const user = await signUp(fixture);
    const svc = service(async () => reply({ elements: [] }));
    for (let i = 0; i < 30; i++)
      await svc.nearby(user.id, { ...DELHI, categories: ["police"] });
    await expect(
      svc.nearby(user.id, { ...DELHI, categories: ["police"] }),
    ).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMIT",
    });
  });

  describe("Safe Havens", () => {
    function haven(over: Record<string, unknown> = {}) {
      const row = {
        id: randomUUID(),
        name: "Participating Chemist",
        kind: "pharmacy",
        latitude: metersNorth(200),
        longitude: DELHI.lon,
        address: null,
        phone: null,
        hours: null,
        status: "verified",
        source: "participant",
        verification_method: "In-person visit by SAKHI team",
        verified_at: NOW - DAY,
        created_at: NOW - 2 * DAY,
        updated_at: NOW - DAY,
        ...over,
      };
      fixture.db
        .prepare(
          `INSERT INTO safe_havens(id,name,kind,latitude,longitude,address,phone,hours,status,source,verification_method,verified_at,created_at,updated_at)
           VALUES(@id,@name,@kind,@latitude,@longitude,@address,@phone,@hours,@status,@source,@verification_method,@verified_at,@created_at,@updated_at)`,
        )
        .run(row);
      return row;
    }
    const noOsm = async () => reply({ elements: [] });

    it("lists only verified, participating havens, labelled with how they were verified", async () => {
      const user = await signUp(fixture);
      const good = haven();
      haven({
        name: "Pending shop",
        status: "pending",
        verification_method: null,
        verified_at: null,
      });
      haven({ name: "Suspended shop", status: "suspended" });
      const result = await service(noOsm).nearby(user.id, {
        ...DELHI,
        categories: ["safe_haven"],
      });
      expect(result.places).toHaveLength(1);
      expect(result.places[0]).toMatchObject({
        id: `sakhi:${good.id}`,
        category: "safe_haven",
        source: "sakhi_safe_haven",
        verified: true,
        verification_note: "Verified: In-person visit by SAKHI team",
      });
      expect(result.sources[0]).toMatchObject({
        provider: "safe_havens",
        status: "fresh",
      });
    });

    it("shows demo havens only when explicitly requested outside production, and never as verified", async () => {
      const user = await signUp(fixture);
      haven({
        source: "demo",
        name: "Demo Cafe",
        verification_method: "demo fixture",
      });
      const svc = service(noOsm);
      const input = { ...DELHI, categories: ["safe_haven"] as ["safe_haven"] };
      expect((await svc.nearby(user.id, input)).places).toEqual([]);
      const demo = await svc.nearby(user.id, { ...input, include_demo: true });
      expect(demo.places[0]).toMatchObject({ source: "demo", verified: false });
      expect(demo.places[0].verification_note).toMatch(
        /not a real participating location/,
      );
      vi.stubEnv("NODE_ENV", "production");
      expect(
        (await svc.nearby(user.id, { ...input, include_demo: true })).places,
      ).toEqual([]);
      vi.stubEnv("ALLOW_DEMO_DATA", "1");
      expect(
        (await svc.nearby(user.id, { ...input, include_demo: true })).places,
      ).toHaveLength(1);
    });

    it("never promotes an ordinary mapped pharmacy to a Safe Haven", async () => {
      const user = await signUp(fixture);
      const svc = service(async () =>
        reply({
          elements: [
            node(1, metersNorth(50), DELHI.lon, { name: "Corner Chemist" }),
          ],
        }),
      );
      const result = await svc.nearby(user.id, {
        ...DELHI,
        categories: ["pharmacy", "safe_haven"],
      });
      expect(result.places).toHaveLength(1);
      expect(result.places[0]).toMatchObject({
        category: "pharmacy",
        verified: false,
        source: "osm",
      });
    });

    it("is enforced by the database: a verified haven needs a verification method", () => {
      expect(() => haven({ verification_method: null })).toThrow(/CHECK/);
      expect(() => haven({ verified_at: null })).toThrow(/CHECK/);
    });

    it("merges havens and mapped places into one distance-ordered list", async () => {
      const user = await signUp(fixture);
      haven({ latitude: metersNorth(300) });
      const svc = service(async () =>
        reply({
          elements: [
            node(1, metersNorth(100), DELHI.lon, { name: "Closer" }),
            node(2, metersNorth(900), DELHI.lon, { name: "Farther" }),
          ],
        }),
      );
      const result = await svc.nearby(user.id, {
        ...DELHI,
        categories: ["pharmacy", "safe_haven"],
      });
      expect(result.places.map((p) => p.distance_m)).toEqual([100, 300, 900]);
    });
  });
});
