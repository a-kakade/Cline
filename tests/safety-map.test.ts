import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import * as authModule from "../src/server/auth";
import * as databaseModule from "../src/server/database";
import * as servicesModule from "../src/server/services";
import { AreaSafetyService, levelFor, MODEL } from "../src/server/area-safety";
import { OverpassClient } from "../src/server/places/overpass";
import { PlacesService } from "../src/server/places/service";
import { ReportService } from "../src/server/reports";
import { RoutingService } from "../src/server/routing";
import { areaForPoint } from "../src/lib/geo";
import { applyRetention } from "../src/server/retention";
import { GET as nearbyRoute } from "../src/app/api/places/nearby/route";
import {
  GET as listReports,
  POST as postReport,
} from "../src/app/api/reports/route";
import { GET as areaRoute } from "../src/app/api/areas/summary/route";
import { POST as compareRoute } from "../src/app/api/routes/compare/route";
import {
  createAuthFixture,
  signUp,
  TEST_ORIGIN,
  type AuthFixture,
} from "./helpers";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const HERE = { lat: 28.6139, lon: 77.209 };
const north = (m: number) => HERE.lat + m / 111_194.9266;

describe("safety map services with real SQLite", () => {
  let fixture: AuthFixture;
  let now: number;

  beforeEach(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(48).toString("base64url"));
    vi.stubEnv("BETTER_AUTH_URL", TEST_ORIGIN);
    vi.stubEnv("DATABASE_PATH", ":memory:");
    fixture = await createAuthFixture();
    now = NOW;
    vi.spyOn(authModule, "getAuth").mockReturnValue(fixture.auth);
    vi.spyOn(databaseModule, "getDatabase").mockReturnValue(fixture.db);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fixture?.close();
  });

  const reports = () => new ReportService(fixture.db, () => now);
  const areas = () => new AreaSafetyService(fixture.db, () => now);
  const reportInput = (over: Record<string, unknown> = {}) => ({
    idempotency_key: randomUUID(),
    kind: "incident",
    category: "harassment",
    ...HERE,
    consent: true,
    ...over,
  });
  function insertReport(over: Record<string, unknown> = {}) {
    const row = {
      id: randomUUID(),
      kind: "incident",
      category: "harassment",
      description: null,
      latitude: HERE.lat,
      longitude: HERE.lon,
      area_id: areaForPoint(HERE.lat, HERE.lon).id,
      occurred_at: null,
      created_at: now - DAY,
      verification: "unverified",
      status: "visible",
      source: "user",
      reporter_id: null,
      ...over,
    };
    fixture.db
      .prepare(
        `INSERT INTO reports(id,kind,category,description,latitude,longitude,area_id,occurred_at,created_at,verification,status,source,reporter_id)
         VALUES(@id,@kind,@category,@description,@latitude,@longitude,@area_id,@occurred_at,@created_at,@verification,@status,@source,@reporter_id)`,
      )
      .run(row);
    return row;
  }

  describe("reports", () => {
    it("stores an unverified report with a rounded position and labels it honestly", async () => {
      const user = await signUp(fixture);
      const report = reports().create(
        user.id,
        reportInput({
          lat: 28.61393,
          lon: 77.20907,
          description: "  Dark\u0000 lane\n near gate  ",
        }),
      );
      expect(report).toMatchObject({
        kind: "incident",
        verification: "unverified",
        source: "user",
        source_label: "Unverified user report",
        lat: 28.614,
        lon: 77.209,
        description: "Dark lane near gate",
        age_days: 0,
      });
      expect(report.limitation).toMatch(/not.*how safe a place is/i);
      const stored = fixture.db
        .prepare("SELECT latitude,longitude,reporter_id FROM reports")
        .get() as Record<string, unknown>;
      expect(stored).toEqual({
        latitude: 28.614,
        longitude: 77.209,
        reporter_id: user.id,
      });
    });

    it("never exposes who reported", async () => {
      const user = await signUp(fixture);
      const report = reports().create(user.id, reportInput());
      expect(JSON.stringify(report)).not.toContain(user.id);
      const listed = reports().list(user.id, { ...HERE });
      expect(JSON.stringify(listed)).not.toContain(user.id);
    });

    it("is idempotent per request key and blocks near-duplicate resubmission", async () => {
      const user = await signUp(fixture);
      const input = reportInput();
      const a = reports().create(user.id, input);
      expect(reports().create(user.id, input).id).toBe(a.id);
      expect(
        fixture.db.prepare("SELECT COUNT(*) AS n FROM reports").get(),
      ).toEqual({ n: 1 });
      expect(() => reports().create(user.id, reportInput())).toThrow(
        expect.objectContaining({ code: "DUPLICATE_REPORT", status: 409 }),
      );
      // A different category, or the same category the next day, is fine.
      reports().create(user.id, reportInput({ category: "stalking" }));
      now += DAY + 1;
      reports().create(user.id, reportInput());
    });

    it("validates kind/category pairing, consent, time and position", async () => {
      const user = await signUp(fixture);
      for (const bad of [
        { category: "poor_lighting" }, // hazard category on an incident
        { kind: "infrastructure_hazard", category: "harassment" },
        { consent: false },
        { lat: 120 },
        { description: "x".repeat(501) },
        { extra: true },
      ])
        expect(() => reports().create(user.id, reportInput(bad))).toThrow(
          ZodError,
        );
      expect(() =>
        reports().create(
          user.id,
          reportInput({ occurred_at: now + 10 * 60_000 }),
        ),
      ).toThrow(expect.objectContaining({ code: "INVALID_TIME" }));
      expect(() =>
        reports().create(
          user.id,
          reportInput({ occurred_at: now - 400 * DAY }),
        ),
      ).toThrow(expect.objectContaining({ code: "INVALID_TIME" }));
      expect(
        fixture.db.prepare("SELECT COUNT(*) AS n FROM reports").get(),
      ).toEqual({ n: 0 });
    });

    it("rate-limits per minute and per day", async () => {
      const user = await signUp(fixture);
      const cats = [
        "harassment",
        "stalking",
        "theft_or_snatching",
        "assault",
        "unsafe_transport",
        "other",
      ];
      for (let i = 0; i < 5; i++)
        reports().create(user.id, reportInput({ category: cats[i] }));
      expect(() =>
        reports().create(user.id, reportInput({ category: cats[5] })),
      ).toThrow(expect.objectContaining({ status: 429 }));
      const other = await signUp(fixture);
      for (let i = 0; i < 20; i++) {
        now += 61_000;
        reports().create(other.id, reportInput({ lat: north(1000 * (i + 1)) }));
      }
      now += 61_000;
      expect(() =>
        reports().create(other.id, reportInput({ lat: north(50_000) })),
      ).toThrow(
        expect.objectContaining({
          code: "RATE_LIMIT",
          message: expect.stringContaining("today"),
        }),
      );
    });

    it("lists by distance and window, hiding hidden rows and demo data unless asked", async () => {
      const user = await signUp(fixture);
      insertReport({ latitude: north(100) });
      insertReport({ latitude: north(3000) }); // outside radius
      insertReport({ latitude: north(200), status: "hidden" });
      insertReport({ latitude: north(300), created_at: now - 200 * DAY }); // outside 90-day window
      insertReport({ latitude: north(150), source: "synthetic_demo" });
      const base = { ...HERE, radius_m: 1000 };
      expect(reports().list(user.id, base).reports).toHaveLength(1);
      expect(
        reports().list(user.id, { ...base, since_days: 365 }).reports,
      ).toHaveLength(2);
      const demo = reports().list(user.id, { ...base, include_demo: true });
      expect(demo.includes_demo).toBe(true);
      const labelled = demo.reports.find((r) => r.source === "synthetic_demo")!;
      expect(labelled.source_label).toBe("Demo data (synthetic)");
      expect(labelled.limitation).toMatch(/did not happen/);
      vi.stubEnv("NODE_ENV", "production");
      expect(
        reports().list(user.id, { ...base, include_demo: true }),
      ).toMatchObject({ includes_demo: false });
      expect(
        reports()
          .list(user.id, { ...base, include_demo: true })
          .reports.every((r) => r.source === "user"),
      ).toBe(true);
    });

    it("filters by kind", async () => {
      const user = await signUp(fixture);
      insertReport();
      insertReport({
        kind: "infrastructure_hazard",
        category: "poor_lighting",
      });
      expect(
        reports()
          .list(user.id, { ...HERE, kinds: ["infrastructure_hazard"] })
          .reports.map((r) => r.category),
      ).toEqual(["poor_lighting"]);
    });
  });

  describe("retention", () => {
    it("drops stale provider cache and reports older than two years, but keeps demo and recent data", () => {
      fixture.db
        .prepare(
          "INSERT INTO places_cache(key,category,payload,fetched_at) VALUES('old','police','[]',?),('new','police','[]',?)",
        )
        .run(now - 8 * DAY, now - DAY);
      insertReport({ id: "old", created_at: now - 800 * DAY });
      insertReport({ id: "recent" });
      insertReport({
        id: "demo-old",
        source: "synthetic_demo",
        created_at: now - 800 * DAY,
      });
      const result = applyRetention(fixture.db, now);
      expect(result).toMatchObject({ placesCache: 1, oldReports: 1 });
      expect(fixture.db.prepare("SELECT key FROM places_cache").all()).toEqual([
        { key: "new" },
      ]);
      expect(
        fixture.db.prepare("SELECT id FROM reports ORDER BY id").all(),
      ).toEqual([{ id: "demo-old" }, { id: "recent" }]);
    });
  });

  describe("area-concern indicator", () => {
    const summarize = (user: string, extra: Record<string, unknown> = {}) =>
      areas().summarize(user, { ...HERE, ...extra });

    it("says 'not enough data' (never 'safe') when there are few reports", async () => {
      const user = await signUp(fixture);
      const empty = summarize(user.id);
      expect(empty.indicator).toMatchObject({
        level: "insufficient_data",
        points: null,
      });
      expect(empty.indicator.explanation).toMatch(
        /does not mean the area is safe/,
      );
      expect(empty.limitations.join(" ")).toMatch(
        /absence of reports is not proof of safety/i,
      );
      insertReport();
      insertReport();
      expect(summarize(user.id).indicator.level).toBe("insufficient_data");
    });

    it("keeps each signal separate and traceable to counts", async () => {
      const user = await signUp(fixture);
      for (let i = 0; i < 3; i++) insertReport();
      insertReport({ verification: "verified" });
      insertReport({
        kind: "infrastructure_hazard",
        category: "poor_lighting",
      });
      const s = summarize(user.id);
      expect(s.signals.unverified_reports.count).toBe(3);
      expect(s.signals.verified_incidents.count).toBe(1);
      expect(s.signals.infrastructure_hazards.count).toBe(1);
      expect(s.signals.official_statistics.status).toBe("unavailable");
      expect(s.signals.community_ratings.status).toBe("unavailable");
      expect(s.signals.ai_summaries.status).toBe("none");
      // 3×1 + 1×3 + 1×1.5
      expect(s.indicator.points).toBe(7.5);
      expect(s.indicator.level).toBe("some_reports");
      expect(s.model).toMatchObject({ name: MODEL.name, validated: false });
      expect(s.signals.verified_incidents.latest_at).toBe(NOW - DAY);
    });

    it("caps the influence of any one signal and escalates levels at documented thresholds", async () => {
      expect(levelFor(2, 100)).toBe("insufficient_data");
      expect(levelFor(3, 3)).toBe("few_reports");
      expect(levelFor(5, MODEL.thresholds.some_at)).toBe("some_reports");
      expect(levelFor(12, MODEL.thresholds.many_at)).toBe("many_reports");
      const user = await signUp(fixture);
      for (let i = 0; i < 40; i++) insertReport();
      const s = summarize(user.id);
      expect(s.signals.unverified_reports.count).toBe(40);
      expect(s.indicator.points).toBe(
        MODEL.caps.unverified_report * MODEL.weights.unverified_report,
      );
      expect(s.indicator.level).toBe("many_reports");
    });

    it("excludes hidden, out-of-window, other-area and (by default) demo records", async () => {
      const user = await signUp(fixture);
      for (let i = 0; i < 3; i++) insertReport();
      insertReport({ status: "hidden" });
      insertReport({ created_at: now - 400 * DAY });
      insertReport({ area_id: areaForPoint(19.07, 72.87).id });
      for (let i = 0; i < 5; i++) insertReport({ source: "synthetic_demo" });
      const plain = summarize(user.id);
      expect(plain.signals.unverified_reports.count).toBe(3);
      expect(plain.includes_demo).toBe(false);
      const withDemo = summarize(user.id, { include_demo: true });
      expect(withDemo.signals.unverified_reports.count).toBe(8);
      expect(withDemo.limitations.join(" ")).toMatch(/DEMO DATA/);
      expect(
        summarize(user.id, { since_days: 3650 }).signals.unverified_reports
          .count,
      ).toBe(4);
    });

    it("accepts an area id, rejects unknown ones, and needs a position or id", async () => {
      const user = await signUp(fixture);
      const id = areaForPoint(HERE.lat, HERE.lon).id;
      expect(areas().summarize(user.id, { area_id: id }).area.id).toBe(id);
      expect(() => areas().summarize(user.id, { area_id: "nonsense" })).toThrow(
        expect.objectContaining({ code: "INVALID_AREA" }),
      );
      expect(() => areas().summarize(user.id, {})).toThrow(ZodError);
    });
  });

  describe("route comparison", () => {
    const FROM = { lat: 28.6139, lon: 77.209 };
    const TO = { lat: 28.6129, lon: 77.2295 };
    const osrm = (routes: unknown[], code = "Ok") => ({ code, routes });
    const line = (pts: [number, number][]) => ({
      coordinates: pts.map(([lat, lon]) => [lon, lat]),
    });
    function service(fetchImpl: (url: string) => Promise<Response>) {
      return new RoutingService(
        fixture.db,
        fetchImpl as never,
        () => now,
        "https://osrm.test",
        500,
      );
    }

    it("compares alternatives and counts nearby data per route without scoring safety", async () => {
      const user = await signUp(fixture);
      // Route A passes through the reported spot; route B stays ~2 km south.
      const a = line([
        [28.6139, 77.209],
        [28.6139, 77.22],
        [28.6129, 77.2295],
      ]);
      const b = line([
        [28.6139, 77.209],
        [28.595, 77.22],
        [28.6129, 77.2295],
      ]);
      insertReport({ latitude: 28.6139, longitude: 77.215 });
      insertReport({
        latitude: 28.6139,
        longitude: 77.216,
        verification: "verified",
      });
      insertReport({
        kind: "infrastructure_hazard",
        category: "poor_lighting",
        latitude: 28.614,
        longitude: 77.217,
      });
      insertReport({
        latitude: 28.6139,
        longitude: 77.218,
        source: "synthetic_demo",
      });
      fixture.db
        .prepare(
          `INSERT INTO safe_havens(id,name,kind,latitude,longitude,status,source,verification_method,verified_at,created_at,updated_at)
           VALUES('h1','Chemist','pharmacy',28.6141,77.2105,'verified','participant','visit',1,1,1)`,
        )
        .run();
      const urls: string[] = [];
      const svc = service(
        async (url) => (
          urls.push(url),
          new Response(
            JSON.stringify(
              osrm([
                { distance: 3981, duration: 396, geometry: a },
                { distance: 5572, duration: 562, geometry: b },
              ]),
            ),
          )
        ),
      );
      const result = await svc.compare(user.id, { from: FROM, to: TO });
      expect(urls[0]).toContain(
        "/route/v1/driving/77.20900,28.61390;77.22950,28.61290",
      );
      expect(urls[0]).toContain("alternatives=true");
      expect(result.routes).toHaveLength(2);
      expect(result.routes[0]).toMatchObject({
        distance_m: 3981,
        duration_s: 396,
        nearby: {
          unverified_reports: 1,
          verified_reports: 1,
          infrastructure_hazards: 1,
          safe_havens: 1,
          demo_reports_included: false,
        },
      });
      // The Safe Haven sits ~140 m from the shared start, so it is near both routes.
      expect(result.routes[1].nearby).toMatchObject({
        unverified_reports: 0,
        verified_reports: 0,
        infrastructure_hazards: 0,
        safe_havens: 1,
      });
      expect(result.routes[0].geometry[0]).toEqual([28.6139, 77.209]);
      expect(result.provider).toMatchObject({
        network: "vehicle road network",
        production_suitable: false,
      });
      expect(result.notes.join(" ")).toMatch(/not walking routes/);
      expect(result.notes.join(" ")).toMatch(
        /describe data, not how safe a route is/,
      );
      expect(JSON.stringify(result)).not.toMatch(/\"(score|safest|risk)\"/i);
      const withDemo = await service(
        async () =>
          new Response(
            JSON.stringify(osrm([{ distance: 1, duration: 1, geometry: a }])),
          ),
      ).compare(user.id, { from: FROM, to: TO, include_demo: true });
      expect(withDemo.routes[0].nearby).toMatchObject({
        unverified_reports: 2,
        demo_reports_included: true,
      });
    });

    it("reports provider failure, no-route and invalid replies distinctly without leaking details", async () => {
      const user = await signUp(fixture);
      const fail = (r: () => Promise<Response>) =>
        service(r).compare(user.id, { from: FROM, to: TO });
      await expect(
        fail(async () => new Response("x", { status: 500 })),
      ).rejects.toMatchObject({ status: 503, code: "ROUTING_UNAVAILABLE" });
      await expect(
        fail(async () => {
          throw new TypeError("connect ECONNREFUSED 10.0.0.1");
        }),
      ).rejects.toMatchObject({ status: 503 });
      await expect(
        fail(async () => {
          throw new DOMException("t", "TimeoutError");
        }),
      ).rejects.toMatchObject({ status: 503 });
      await expect(
        fail(async () => new Response(JSON.stringify(osrm([], "NoRoute")))),
      ).rejects.toMatchObject({ status: 404, code: "NO_ROUTE" });
      await expect(
        fail(async () => new Response("not json")),
      ).rejects.toMatchObject({ status: 503 });
      await expect(
        fail(
          async () =>
            new Response(JSON.stringify({ code: "Ok", routes: [{ nope: 1 }] })),
        ),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("validates points, limits distance and rate", async () => {
      const user = await signUp(fixture);
      const svc = service(
        async () =>
          new Response(
            JSON.stringify(
              osrm([
                {
                  distance: 1,
                  duration: 1,
                  geometry: line([
                    [28.6, 77.2],
                    [28.61, 77.21],
                  ]),
                },
              ]),
            ),
          ),
      );
      await expect(
        svc.compare(user.id, { from: { lat: 99, lon: 0 }, to: TO }),
      ).rejects.toThrow(ZodError);
      await expect(
        svc.compare(user.id, { from: FROM, to: { lat: 19.07, lon: 72.87 } }),
      ).rejects.toMatchObject({ code: "TOO_FAR" });
      for (let i = 0; i < 19; i++)
        await svc.compare(user.id, { from: FROM, to: TO });
      await expect(
        svc.compare(user.id, { from: FROM, to: TO }),
      ).rejects.toMatchObject({ status: 429 });
    });
  });

  describe("HTTP API", () => {
    const req = (
      method: string,
      path: string,
      opts: { cookie?: string; input?: unknown; origin?: string } = {},
    ) => {
      const headers = new Headers({ "content-type": "application/json" });
      if (opts.cookie) headers.set("cookie", opts.cookie);
      headers.set("origin", opts.origin ?? TEST_ORIGIN);
      return new Request(`${TEST_ORIGIN}${path}`, {
        method,
        headers,
        body: opts.input === undefined ? undefined : JSON.stringify(opts.input),
      });
    };

    it("requires a session on every endpoint", async () => {
      for (const response of [
        await nearbyRoute(req("GET", `/api/places/nearby?lat=28.6&lon=77.2`)),
        await listReports(req("GET", `/api/reports?lat=28.6&lon=77.2`)),
        await postReport(req("POST", "/api/reports", { input: reportInput() })),
        await areaRoute(req("GET", `/api/areas/summary?lat=28.6&lon=77.2`)),
        await compareRoute(req("POST", "/api/routes/compare", { input: {} })),
      ])
        expect(response.status).toBe(401);
    });

    it("parses query strings strictly and passes them to the places service", async () => {
      const user = await signUp(fixture);
      const calls: unknown[] = [];
      vi.spyOn(servicesModule, "placesService").mockReturnValue({
        nearby: async (_u: string, input: unknown) => (
          calls.push(input),
          {
            places: [],
            sources: [],
            query: { radius_m: 1, categories: [] },
            attribution: "x",
          }
        ),
      } as unknown as PlacesService);
      const ok = await nearbyRoute(
        req(
          "GET",
          "/api/places/nearby?lat=28.6139&lon=77.209&radius_m=1500&categories=police,hospital&include_demo=1",
          { cookie: user.cookie },
        ),
      );
      expect(ok.status).toBe(200);
      expect(calls[0]).toEqual({
        lat: 28.6139,
        lon: 77.209,
        radius_m: 1500,
        categories: ["police", "hospital"],
        include_demo: true,
      });
      const nan = await nearbyRoute(
        req("GET", "/api/places/nearby?lat=abc&lon=1", { cookie: user.cookie }),
      );
      expect(nan.status).toBe(400);
    });

    it("reports a service-level validation failure as 400 and an unknown parameter as 400", async () => {
      const user = await signUp(fixture);
      vi.spyOn(servicesModule, "placesService").mockReturnValue(
        new PlacesService(
          fixture.db,
          new OverpassClient({
            endpoints: ["https://x.test"],
            fetch: (async () => new Response('{"elements":[]}')) as never,
            minIntervalMs: 0,
          }),
          () => now,
        ),
      );
      const bad = await nearbyRoute(
        req("GET", "/api/places/nearby?lat=95&lon=1", { cookie: user.cookie }),
      );
      expect(bad.status).toBe(400);
      expect((await bad.json()).error.code).toBe("INVALID_INPUT");
      const unknown = await nearbyRoute(
        req("GET", "/api/places/nearby?lat=28.6&lon=77.2&evil=1", {
          cookie: user.cookie,
        }),
      );
      expect(unknown.status).toBe(400);
      const ok = await nearbyRoute(
        req("GET", "/api/places/nearby?lat=28.6&lon=77.2&categories=police", {
          cookie: user.cookie,
        }),
      );
      expect(ok.status).toBe(200);
      expect((await ok.json()).data.sources[0]).toMatchObject({
        category: "police",
        status: "fresh",
      });
    });

    it("creates then lists a report, and returns an area summary, end to end", async () => {
      const user = await signUp(fixture);
      const created = await postReport(
        req("POST", "/api/reports", {
          cookie: user.cookie,
          input: reportInput(),
        }),
      );
      expect(created.status).toBe(201);
      const listed = await (
        await listReports(
          req(
            "GET",
            `/api/reports?lat=${HERE.lat}&lon=${HERE.lon}&since_days=3650`,
            { cookie: user.cookie },
          ),
        )
      ).json();
      expect(listed.data.reports).toHaveLength(1);
      const summary = await (
        await areaRoute(
          req("GET", `/api/areas/summary?lat=${HERE.lat}&lon=${HERE.lon}`, {
            cookie: user.cookie,
          }),
        )
      ).json();
      expect(summary.data.signals.unverified_reports.count).toBe(1);
      expect(summary.data.indicator.level).toBe("insufficient_data");
    });

    it("blocks cross-origin report submissions", async () => {
      const user = await signUp(fixture);
      const response = await postReport(
        req("POST", "/api/reports", {
          cookie: user.cookie,
          origin: "https://evil.example",
          input: reportInput(),
        }),
      );
      expect(response.status).toBe(403);
      expect(
        fixture.db.prepare("SELECT COUNT(*) AS n FROM reports").get(),
      ).toEqual({ n: 0 });
    });
  });
});
