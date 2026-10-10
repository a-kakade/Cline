import type Database from "better-sqlite3";
import { z } from "zod";
import { areaForPoint, areaFromId } from "@/lib/geo";
import type { AreaSignals, ConcernLevel } from "@/lib/safety-types";
import { throttle } from "./audit";
import { AppError } from "./http";
import { RatingService } from "./ratings";
import { demoAllowed } from "./places/service";

const DAY = 86_400_000;
// Prototype, hand-set weights. Not fitted to data and not validated against outcomes.
export const MODEL = {
  name: "report-volume-prototype-v1",
  validated: false as const,
  weights: {
    verified_incident: 3,
    unverified_report: 1,
    infrastructure_hazard: 1.5,
  },
  caps: {
    verified_incident: 5,
    unverified_report: 10,
    infrastructure_hazard: 5,
  },
  thresholds: { insufficient_below: 3, some_at: 4, many_at: 10 },
};

export const areaQuerySchema = z
  .object({
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    area_id: z.string().max(40).optional(),
    since_days: z.number().int().min(7).max(3650).default(90),
    include_demo: z.boolean().default(false),
  })
  .strict()
  .refine((v) => v.area_id || (v.lat !== undefined && v.lon !== undefined), {
    message: "Provide an area id or a position.",
  });

const LABELS: Record<ConcernLevel, string> = {
  insufficient_data: "Not enough reports to say anything",
  few_reports: "Few reports",
  some_reports: "Some reports",
  many_reports: "Many reports",
};

export function levelFor(dataPoints: number, points: number): ConcernLevel {
  if (dataPoints < MODEL.thresholds.insufficient_below)
    return "insufficient_data";
  if (points >= MODEL.thresholds.many_at) return "many_reports";
  if (points >= MODEL.thresholds.some_at) return "some_reports";
  return "few_reports";
}

export class AreaSafetyService {
  constructor(
    private db: Database.Database,
    private clock = Date.now,
  ) {}

  summarize(userId: string, input: unknown): AreaSignals {
    const data = areaQuerySchema.parse(input);
    throttle(this.db, userId, "area-safety", 60, this.clock());
    const area = data.area_id
      ? areaFromId(data.area_id)
      : areaForPoint(data.lat!, data.lon!);
    if (!area) throw new AppError(400, "INVALID_AREA", "Unknown area.");
    const now = this.clock();
    const demo = data.include_demo && demoAllowed();
    const rows = this.db
      .prepare(
        `SELECT kind,verification,source,COALESCE(occurred_at,created_at) AS at FROM reports
         WHERE status='visible' AND area_id=? AND COALESCE(occurred_at,created_at) >= ?
           AND (source != 'synthetic_demo' OR ?=1)`,
      )
      .all(area.id, now - data.since_days * DAY, +demo) as {
      kind: "incident" | "infrastructure_hazard";
      verification: "unverified" | "verified";
      source: string;
      at: number;
    }[];
    const tally = (pred: (r: (typeof rows)[number]) => boolean) => {
      const m = rows.filter(pred);
      return {
        count: m.length,
        latest_at: m.length ? Math.max(...m.map((r) => r.at)) : null,
      };
    };
    const verified = tally(
      (r) => r.kind === "incident" && r.verification === "verified",
    );
    const unverified = tally(
      (r) => r.kind === "incident" && r.verification === "unverified",
    );
    const hazards = tally((r) => r.kind === "infrastructure_hazard");
    const dataPoints = verified.count + unverified.count + hazards.count;
    const cap = (n: number, c: number) => Math.min(n, c);
    const points =
      cap(verified.count, MODEL.caps.verified_incident) *
        MODEL.weights.verified_incident +
      cap(unverified.count, MODEL.caps.unverified_report) *
        MODEL.weights.unverified_report +
      cap(hazards.count, MODEL.caps.infrastructure_hazard) *
        MODEL.weights.infrastructure_hazard;
    const level = levelFor(dataPoints, points);
    return {
      area: { id: area.id, center: area.center, size_m: area.size_m },
      window_days: data.since_days,
      includes_demo: demo,
      indicator: {
        level,
        points: level === "insufficient_data" ? null : points,
        label: LABELS[level],
        explanation:
          level === "insufficient_data"
            ? `Only ${dataPoints} report${dataPoints === 1 ? "" : "s"} in this ${area.size_m} m area over ${data.since_days} days. No reports does not mean the area is safe.`
            : `${dataPoints} reports in the last ${data.since_days} days weighted by type (${points} points). This counts reports, which depend on who chooses to report; it is not a crime rate or a prediction.`,
      },
      signals: {
        official_statistics: {
          status: "unavailable",
          note: "No licensed, street-level official statistics are connected. Published aggregates (e.g. NCRB) are annual and city/district level, so they are not used here.",
        },
        verified_incidents: verified,
        unverified_reports: unverified,
        infrastructure_hazards: hazards,
        // Shown beside, never mixed into, the points above.
        community_ratings: new RatingService(this.db, this.clock).signal(
          area.id,
        ),
        ai_summaries: {
          status: "none",
          note: "Any AI-written summary is a language-model description of the numbers above, not evidence.",
        },
      },
      model: { ...MODEL },
      limitations: [
        "Reports are voluntary and biased toward places and people who use the app.",
        "An absence of reports is not proof of safety.",
        "This prototype indicator is not scientifically validated.",
        ...(demo
          ? ["DEMO DATA is included: synthetic records that did not happen."]
          : []),
      ],
    };
  }
}
