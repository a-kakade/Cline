import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCsv, seedDemo } from "../src/server/demo-seed";
import { createAuthFixture, type AuthFixture } from "./helpers";

const NOW = 1_800_000_000_000;
const CSV = [
  "incident_id,city,area,latitude,longitude,crime_type,crime_count,time_of_day,lighting_score,incident_timestamp",
  "a1,Delhi,CP,28.6139,77.2090,Stalking,3,Night,1.5,2025-05-14 12:40:25",
  'a2,Delhi,CP,28.6140,77.2091,"Chain Snatching",3,Night,6.0,2025-05-10 12:40:25',
  "a3,Delhi,CP,28.6141,77.2092,Cyber Crime,3,Night,6.0,2025-05-12 12:40:25",
  "a4,Mumbai,Kurla,18.9976,72.9062,Assault,3,Night,9.0,not-a-date",
  "a5,Mumbai,Kurla,999,72.9062,Assault,3,Night,9.0,2025-05-12 12:40:25",
].join("\n");

describe("demo data seeding", () => {
  let fixture: AuthFixture;
  beforeEach(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(48).toString("base64url"));
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    fixture = await createAuthFixture();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fixture.close();
  });

  it("parses quoted fields and CRLF line endings", () => {
    const rows = parseCsv('a,b\r\n1,"x, y"\r\n2,"he said ""hi"""\r\n');
    expect(rows).toEqual([
      { a: "1", b: "x, y" },
      { a: "2", b: 'he said "hi"' },
    ]);
  });

  it("loads only labelled synthetic records and skips what it cannot place", () => {
    const result = seedDemo(fixture.db, CSV, { now: NOW });
    expect(result).toEqual({ reports: 2, hazards: 1, skipped: 3, havens: 2 });
    const sources = fixture.db
      .prepare("SELECT DISTINCT source,verification,reporter_id FROM reports")
      .all();
    expect(sources).toEqual([
      {
        source: "synthetic_demo",
        verification: "unverified",
        reporter_id: null,
      },
    ]);
    const havens = fixture.db
      .prepare("SELECT name,source,status FROM safe_havens")
      .all() as { name: string; source: string }[];
    expect(
      havens.every(
        (h) => h.source === "demo" && /not a real place/.test(h.name),
      ),
    ).toBe(true);
    const descriptions = fixture.db
      .prepare("SELECT description FROM reports")
      .all() as { description: string }[];
    expect(
      descriptions.every((d) => d.description.startsWith("DEMO (synthetic)")),
    ).toBe(true);
  });

  it("rebases dates so the newest record is 'now' unless told not to, and is re-runnable", () => {
    seedDemo(fixture.db, CSV, { now: NOW });
    const newest = fixture.db
      .prepare("SELECT MAX(occurred_at) AS t FROM reports")
      .get() as { t: number };
    expect(newest.t).toBe(NOW);
    seedDemo(fixture.db, CSV, { now: NOW, rebase: false });
    expect(
      fixture.db.prepare("SELECT COUNT(*) AS n FROM reports").get(),
    ).toEqual({ n: 3 });
    expect(
      (
        fixture.db
          .prepare("SELECT MAX(occurred_at) AS t FROM reports")
          .get() as { t: number }
      ).t,
    ).toBeLessThan(NOW);
  });

  it("never touches real user reports or real Safe Havens", () => {
    fixture.db
      .prepare(
        `INSERT INTO reports(id,kind,category,latitude,longitude,area_id,created_at,source) VALUES('r','incident','other',1,1,'g500:1:1',1,'user')`,
      )
      .run();
    fixture.db
      .prepare(
        `INSERT INTO safe_havens(id,name,kind,latitude,longitude,status,source,verification_method,verified_at,created_at,updated_at)
         VALUES('h','Real','shop',1,1,'verified','participant','visit',1,1,1)`,
      )
      .run();
    seedDemo(fixture.db, CSV, { now: NOW });
    expect(
      fixture.db.prepare("SELECT id FROM reports WHERE source='user'").all(),
    ).toHaveLength(1);
    expect(
      fixture.db
        .prepare("SELECT id FROM safe_havens WHERE source='participant'")
        .all(),
    ).toHaveLength(1);
  });

  it("refuses to run in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => seedDemo(fixture.db, CSV, { now: NOW })).toThrow(/Refusing/);
    expect(
      fixture.db.prepare("SELECT COUNT(*) AS n FROM reports").get(),
    ).toEqual({ n: 0 });
  });
});
