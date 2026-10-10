import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { areaFromId } from "@/lib/geo";
import { audit, throttle } from "./audit";
import { AppError } from "./http";

export const MIN_RATINGS_TO_SHOW = 5;
const DAY = 86_400_000;
const stars = z.number().int().min(1).max(5);
export const ratingSchema = z
  .object({
    stars,
    day_stars: stars.nullable().optional(),
    night_stars: stars.nullable().optional(),
    review: z.string().max(1000).nullable().optional(),
  })
  .strict();
const reportSchema = z
  .object({ reason: z.enum(["abuse", "spam", "privacy", "other"]) })
  .strict();

const clean = (v: string) =>
  v
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
// Reviews are public; keep contact details out of them.
const CONTACT_DETAILS = /(\+?\d[\s-]?){10,}|[\w.+-]+@[\w-]+\.[\w.]+/;

export type Aggregate = {
  average: number | null;
  count: number;
  shown: boolean;
};
export type RatingSummary = {
  area: { id: string; center: { lat: number; lon: number }; size_m: number };
  overall: Aggregate;
  day: Aggregate;
  night: Aggregate;
  distribution: [number, number, number, number, number];
  count_last_90_days: number;
  latest_at: number | null;
  min_to_show: number;
  reviews: {
    id: string;
    stars: number;
    review: string;
    updated_at: number;
    mine: boolean;
  }[];
  my_rating: {
    stars: number;
    day_stars: number | null;
    night_stars: number | null;
    review: string | null;
  } | null;
  disclaimer: string;
};

const aggregate = (values: number[]): Aggregate => ({
  average:
    values.length >= MIN_RATINGS_TO_SHOW
      ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) /
        10
      : null,
  count: values.length,
  shown: values.length >= MIN_RATINGS_TO_SHOW,
});

export class RatingService {
  constructor(
    private db: Database.Database,
    private clock = Date.now,
  ) {}

  private area(areaId: string) {
    const area = areaFromId(areaId);
    if (!area) throw new AppError(400, "INVALID_AREA", "Unknown area.");
    return area;
  }

  summary(userId: string, areaId: string): RatingSummary {
    const area = this.area(areaId);
    throttle(this.db, userId, "rating-read", 60, this.clock());
    const rows = this.db
      .prepare(
        "SELECT id,user_id,stars,day_stars,night_stars,review,updated_at FROM ratings WHERE area_id=? AND status='visible' ORDER BY updated_at DESC",
      )
      .all(areaId) as {
      id: string;
      user_id: string;
      stars: number;
      day_stars: number | null;
      night_stars: number | null;
      review: string | null;
      updated_at: number;
    }[];
    const dist: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    for (const r of rows) dist[r.stars - 1]++;
    const mine = rows.find((r) => r.user_id === userId);
    const now = this.clock();
    return {
      area: { id: area.id, center: area.center, size_m: area.size_m },
      overall: aggregate(rows.map((r) => r.stars)),
      day: aggregate(rows.flatMap((r) => (r.day_stars ? [r.day_stars] : []))),
      night: aggregate(
        rows.flatMap((r) => (r.night_stars ? [r.night_stars] : [])),
      ),
      distribution: dist,
      count_last_90_days: rows.filter((r) => now - r.updated_at <= 90 * DAY)
        .length,
      latest_at: rows[0]?.updated_at ?? null,
      min_to_show: MIN_RATINGS_TO_SHOW,
      reviews: rows
        .filter((r) => r.review)
        .slice(0, 20)
        .map((r) => ({
          id: r.id,
          stars: r.stars,
          review: r.review!,
          updated_at: r.updated_at,
          mine: r.user_id === userId,
        })),
      my_rating: mine
        ? {
            stars: mine.stars,
            day_stars: mine.day_stars,
            night_stars: mine.night_stars,
            review: mine.review,
          }
        : null,
      disclaimer:
        "Ratings are personal opinions from SAKHI users. They are not verified incidents and not a measure of crime. A high rating does not prove an area is safe; a low one does not mean a crime happened.",
    };
  }

  upsert(userId: string, areaId: string, input: unknown) {
    const data = ratingSchema.parse(input);
    this.area(areaId);
    const review = data.review ? clean(data.review) : null;
    if (review && review.length > 280)
      throw new AppError(
        400,
        "TOO_LONG",
        "Reviews can be up to 280 characters.",
      );
    if (review && CONTACT_DETAILS.test(review))
      throw new AppError(
        400,
        "CONTACT_DETAILS",
        "Please leave phone numbers and email addresses out of reviews.",
      );
    const now = this.clock();
    this.db
      .transaction(() => {
        throttle(this.db, userId, "rating-write", 10, now);
        const existing = this.db
          .prepare("SELECT id FROM ratings WHERE area_id=? AND user_id=?")
          .get(areaId, userId) as { id: string } | undefined;
        if (!existing) {
          const daily = this.db
            .prepare(
              "SELECT COUNT(*) AS n FROM ratings WHERE user_id=? AND created_at>?",
            )
            .get(userId, now - DAY) as { n: number };
          if (daily.n >= 20)
            throw new AppError(
              429,
              "RATE_LIMIT",
              "You have reached today’s rating limit.",
            );
        }
        if (existing)
          this.db
            .prepare(
              "UPDATE ratings SET stars=?,day_stars=?,night_stars=?,review=?,status='visible',updated_at=? WHERE id=? AND status IN ('visible')",
            )
            .run(
              data.stars,
              data.day_stars ?? null,
              data.night_stars ?? null,
              review || null,
              now,
              existing.id,
            );
        else
          this.db
            .prepare(
              "INSERT INTO ratings(id,area_id,user_id,stars,day_stars,night_stars,review,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'visible',?,?)",
            )
            .run(
              randomUUID(),
              areaId,
              userId,
              data.stars,
              data.day_stars ?? null,
              data.night_stars ?? null,
              review || null,
              now,
              now,
            );
        audit(
          this.db,
          userId,
          existing ? "rating.updated" : "rating.created",
          areaId,
          now,
        );
      })
      .immediate();
    return this.summary(userId, areaId);
  }

  remove(userId: string, areaId: string) {
    this.area(areaId);
    this.db
      .prepare("DELETE FROM ratings WHERE area_id=? AND user_id=?")
      .run(areaId, userId);
    audit(this.db, userId, "rating.deleted", areaId, this.clock());
    return this.summary(userId, areaId);
  }

  report(userId: string, ratingId: string, input: unknown) {
    const { reason } = reportSchema.parse(input);
    throttle(this.db, userId, "rating-report", 20, this.clock());
    const row = this.db
      .prepare("SELECT user_id FROM ratings WHERE id=? AND status='visible'")
      .get(ratingId) as { user_id: string } | undefined;
    if (!row) throw new AppError(404, "NOT_FOUND", "Rating not found.");
    if (row.user_id === userId)
      throw new AppError(
        400,
        "OWN_RATING",
        "You can’t report your own rating.",
      );
    this.db
      .prepare(
        "INSERT OR IGNORE INTO rating_reports(rating_id,reporter_id,reason,status,created_at) VALUES(?,?,?,'open',?)",
      )
      .run(ratingId, userId, reason, this.clock());
    return { reported: true };
  }

  /** Used by the area indicator panel, which shows ratings separately from incident reports. */
  signal(areaId: string) {
    const rows = this.db
      .prepare("SELECT stars FROM ratings WHERE area_id=? AND status='visible'")
      .all(areaId) as { stars: number }[];
    const agg = aggregate(rows.map((r) => r.stars));
    return {
      status: agg.shown
        ? ("ok" as const)
        : rows.length
          ? ("insufficient" as const)
          : ("unavailable" as const),
      average: agg.average,
      count: rows.length,
    };
  }
}
