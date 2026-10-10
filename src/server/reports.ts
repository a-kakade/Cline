import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { areaForPoint, boundingBox, haversineMeters } from "@/lib/geo";
import {
  HAZARD_CATEGORIES,
  INCIDENT_CATEGORIES,
  type PublicReport,
  type ReportKind,
} from "@/lib/safety-types";
import { audit, throttle } from "./audit";
import { AppError } from "./http";
import { demoAllowed } from "./places/service";

const DAY = 86_400_000;
const clean = (v: string, max: number) =>
  v
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const createSchema = z
  .object({
    idempotency_key: z.uuid(),
    kind: z.enum(["incident", "infrastructure_hazard"]),
    category: z.string().trim().min(1).max(40),
    description: z.string().trim().max(500).optional(),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    occurred_at: z.number().int().positive().optional(),
    consent: z.literal(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    const allowed: readonly string[] =
      v.kind === "incident" ? INCIDENT_CATEGORIES : HAZARD_CATEGORIES;
    if (!allowed.includes(v.category))
      ctx.addIssue({ code: "custom", message: "Choose a listed category." });
  });
export const listSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    radius_m: z.number().int().min(100).max(10_000).default(2000),
    kinds: z
      .array(z.enum(["incident", "infrastructure_hazard"]))
      .min(1)
      .optional(),
    since_days: z.number().int().min(1).max(3650).default(90),
    include_demo: z.boolean().default(false),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .strict();

const LIMITATIONS = {
  user: "Unverified report from a SAKHI user. It has not been checked, may be inaccurate, and reflects who chose to report — not how safe a place is.",
  verified:
    "Verified by a moderator or responder. Still one report, not a measure of overall safety.",
  demo: "DEMO DATA — synthetic record for demonstration. It did not happen.",
} as const;

type Row = {
  id: string;
  kind: ReportKind;
  category: string;
  description: string | null;
  latitude: number;
  longitude: number;
  created_at: number;
  occurred_at: number | null;
  verification: "unverified" | "verified";
  source: "user" | "synthetic_demo";
};

export function toPublic(row: Row, now: number): PublicReport {
  const demo = row.source === "synthetic_demo";
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    description: row.description,
    lat: row.latitude,
    lon: row.longitude,
    created_at: row.created_at,
    occurred_at: row.occurred_at,
    age_days: Math.max(
      0,
      Math.floor((now - (row.occurred_at ?? row.created_at)) / DAY),
    ),
    verification: row.verification,
    source: row.source,
    source_label: demo
      ? "Demo data (synthetic)"
      : row.verification === "verified"
        ? "Verified report"
        : "Unverified user report",
    limitation: demo
      ? LIMITATIONS.demo
      : row.verification === "verified"
        ? LIMITATIONS.verified
        : LIMITATIONS.user,
  };
}

export class ReportService {
  constructor(
    private db: Database.Database,
    private clock = Date.now,
  ) {}

  create(userId: string, input: unknown): PublicReport {
    const data = createSchema.parse(input);
    const now = this.clock();
    if (
      data.occurred_at &&
      (data.occurred_at > now + 60_000 || data.occurred_at < now - 365 * DAY)
    )
      throw new AppError(
        400,
        "INVALID_TIME",
        "Choose a time within the last year.",
      );
    return this.db
      .transaction(() => {
        const previous = this.db
          .prepare(
            "SELECT id FROM report_requests WHERE user_id=? AND idempotency_key=?",
          )
          .get(userId, data.idempotency_key) as { id: string } | undefined;
        if (previous) return this.getPublic(previous.id);
        throttle(this.db, userId, "reports", 5, now);
        const daily = this.db
          .prepare(
            "SELECT COUNT(*) AS n FROM reports WHERE reporter_id=? AND created_at>?",
          )
          .get(userId, now - DAY) as { n: number };
        if (daily.n >= 20)
          throw new AppError(
            429,
            "RATE_LIMIT",
            "You have reached today’s report limit.",
          );
        // Stored position is rounded (~110 m): enough for an area signal, not for locating a person.
        const lat = Math.round(data.lat * 1000) / 1000;
        const lon = Math.round(data.lon * 1000) / 1000;
        const area = areaForPoint(lat, lon);
        const dup = this.db
          .prepare(
            "SELECT 1 FROM reports WHERE reporter_id=? AND area_id=? AND category=? AND created_at>?",
          )
          .get(userId, area.id, data.category, now - DAY);
        if (dup)
          throw new AppError(
            409,
            "DUPLICATE_REPORT",
            "You already reported this here recently.",
          );
        const id = randomUUID();
        this.db
          .prepare(
            `INSERT INTO reports(id,kind,category,description,latitude,longitude,area_id,occurred_at,created_at,verification,status,source,reporter_id)
             VALUES(?,?,?,?,?,?,?,?,?,'unverified','visible','user',?)`,
          )
          .run(
            id,
            data.kind,
            data.category,
            data.description ? clean(data.description, 500) || null : null,
            lat,
            lon,
            area.id,
            data.occurred_at ?? null,
            now,
            userId,
          );
        this.db
          .prepare(
            "INSERT INTO report_requests(user_id,idempotency_key,id) VALUES(?,?,?)",
          )
          .run(userId, data.idempotency_key, id);
        audit(this.db, userId, "report.created", id, now);
        return this.getPublic(id);
      })
      .immediate();
  }

  private getPublic(id: string): PublicReport {
    const row = this.db
      .prepare(
        "SELECT id,kind,category,description,latitude,longitude,created_at,occurred_at,verification,source FROM reports WHERE id=?",
      )
      .get(id) as Row | undefined;
    if (!row) throw new AppError(404, "NOT_FOUND", "Report not found.");
    return toPublic(row, this.clock());
  }

  list(
    userId: string,
    input: unknown,
  ): { reports: PublicReport[]; includes_demo: boolean } {
    const data = listSchema.parse(input);
    throttle(this.db, userId, "reports-read", 60, this.clock());
    const now = this.clock();
    const box = boundingBox(data, data.radius_m);
    const demo = data.include_demo && demoAllowed();
    const kinds = data.kinds ?? ["incident", "infrastructure_hazard"];
    const rows = this.db
      .prepare(
        `SELECT id,kind,category,description,latitude,longitude,created_at,occurred_at,verification,source FROM reports
         WHERE status='visible' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
           AND COALESCE(occurred_at,created_at) >= ? AND (source != 'synthetic_demo' OR ?=1)
           AND kind IN (${kinds.map(() => "?").join(",")})
         ORDER BY COALESCE(occurred_at,created_at) DESC LIMIT 1000`,
      )
      .all(
        box.minLat,
        box.maxLat,
        box.minLon,
        box.maxLon,
        now - data.since_days * DAY,
        +demo,
        ...kinds,
      ) as Row[];
    const reports = rows
      .filter(
        (r) =>
          haversineMeters(data, { lat: r.latitude, lon: r.longitude }) <=
          data.radius_m,
      )
      .slice(0, data.limit)
      .map((r) => toPublic(r, now));
    return { reports, includes_demo: demo };
  }
}
