import type Database from "better-sqlite3";
import { z } from "zod";
import { audit, throttle } from "./audit";
import { AppError } from "./http";
import { getRoomBus, type RoomBus } from "./room-bus";
import { RoomService } from "./rooms";

export type ModerationQueue = {
  alerts: {
    id: string;
    priority: "review" | "urgent";
    category: string;
    created_at: number;
    room_id: string;
    room_name: string;
    message_id: string;
    alias: string;
    body: string | null;
    note: string;
  }[];
  message_reports: {
    id: string;
    reason: string;
    created_at: number;
    room_id: string;
    message_id: string;
    alias: string;
    body: string | null;
    message_status: string;
  }[];
  rating_reports: {
    rating_id: string;
    reason: string;
    created_at: number;
    review: string | null;
    stars: number;
    area_id: string;
  }[];
};

const statusSchema = z
  .object({ status: z.enum(["acknowledged", "dismissed"]) })
  .strict();
const reportStatusSchema = z
  .object({ status: z.enum(["actioned", "dismissed"]) })
  .strict();
const banSchema = z
  .object({ reason: z.string().trim().max(200).optional() })
  .strict();

// Moderator actions. The role is granted only by an operator script, and every
// action is checked server-side and audited by opaque id.
export class ModerationService {
  private rooms: RoomService;
  constructor(
    private db: Database.Database,
    private clock = Date.now,
    private bus: RoomBus = getRoomBus(),
    secret = process.env.BETTER_AUTH_SECRET ?? "",
  ) {
    this.rooms = new RoomService(db, clock, bus, secret);
  }

  isModerator(userId: string) {
    return !!this.db
      .prepare("SELECT 1 FROM user_roles WHERE user_id=? AND role='moderator'")
      .get(userId);
  }
  /** 403 for everyone else, with no hint of what exists. */
  require(userId: string) {
    if (!this.isModerator(userId))
      throw new AppError(403, "FORBIDDEN", "You don’t have access to this.");
  }

  queue(userId: string): ModerationQueue {
    this.require(userId);
    throttle(this.db, userId, "moderation-read", 120, this.clock());
    const alerts = this.db
      .prepare(
        `SELECT a.id,a.priority,a.category,a.created_at,a.room_id,r.name AS room_name,a.message_id,a.author_id,m.body,m.status
         FROM alert_events a JOIN rooms r ON r.id=a.room_id JOIN messages m ON m.id=a.message_id
         WHERE a.status='open' ORDER BY (a.priority='urgent') DESC, a.created_at DESC LIMIT 100`,
      )
      .all() as {
      id: string;
      priority: "review" | "urgent";
      category: string;
      created_at: number;
      room_id: string;
      room_name: string;
      message_id: string;
      author_id: string;
      body: string;
      status: string;
    }[];
    const reports = this.db
      .prepare(
        `SELECT p.id,p.reason,p.created_at,m.room_id,m.id AS message_id,m.user_id,m.body,m.status
         FROM message_reports p JOIN messages m ON m.id=p.message_id WHERE p.status='open' ORDER BY p.created_at DESC LIMIT 100`,
      )
      .all() as {
      id: string;
      reason: string;
      created_at: number;
      room_id: string;
      message_id: string;
      user_id: string;
      body: string;
      status: string;
    }[];
    const ratingReports = this.db
      .prepare(
        `SELECT p.rating_id,p.reason,p.created_at,r.review,r.stars,r.area_id FROM rating_reports p
         JOIN ratings r ON r.id=p.rating_id WHERE p.status='open' ORDER BY p.created_at DESC LIMIT 100`,
      )
      .all() as ModerationQueue["rating_reports"];
    return {
      alerts: alerts.map((a) => ({
        id: a.id,
        priority: a.priority,
        category: a.category,
        created_at: a.created_at,
        room_id: a.room_id,
        room_name: a.room_name,
        message_id: a.message_id,
        alias: this.rooms.alias(a.room_id, a.author_id),
        body: a.status === "visible" ? a.body : null,
        note: "Flagged by automatic rules, which miss many real emergencies and flag harmless messages. Review the message yourself; no one has been contacted.",
      })),
      message_reports: reports.map((p) => ({
        id: p.id,
        reason: p.reason,
        created_at: p.created_at,
        room_id: p.room_id,
        message_id: p.message_id,
        alias: this.rooms.alias(p.room_id, p.user_id),
        body: p.status === "visible" ? p.body : null,
        message_status: p.status,
      })),
      rating_reports: ratingReports,
    };
  }

  handleAlert(userId: string, alertId: string, input: unknown) {
    this.require(userId);
    const { status } = statusSchema.parse(input);
    const now = this.clock();
    const changed = this.db
      .prepare(
        "UPDATE alert_events SET status=?,handled_by=?,handled_at=? WHERE id=? AND status='open'",
      )
      .run(status, userId, now, alertId).changes;
    if (!changed)
      throw new AppError(
        404,
        "NOT_FOUND",
        "That alert is already handled or doesn’t exist.",
      );
    audit(this.db, userId, `alert.${status}`, alertId, now);
    return { status };
  }

  handleReport(userId: string, reportId: string, input: unknown) {
    this.require(userId);
    const { status } = reportStatusSchema.parse(input);
    const changed = this.db
      .prepare(
        "UPDATE message_reports SET status=? WHERE id=? AND status='open'",
      )
      .run(status, reportId).changes;
    if (!changed)
      throw new AppError(
        404,
        "NOT_FOUND",
        "That report is already handled or doesn’t exist.",
      );
    audit(this.db, userId, `report.${status}`, reportId, this.clock());
    return { status };
  }

  hideMessage(userId: string, messageId: string) {
    this.require(userId);
    const now = this.clock();
    const row = this.db
      .prepare("SELECT seq,room_id FROM messages WHERE id=?")
      .get(messageId) as { seq: number; room_id: string } | undefined;
    if (!row) throw new AppError(404, "NOT_FOUND", "Message not found.");
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE messages SET status='hidden' WHERE id=?")
        .run(messageId);
      this.db
        .prepare(
          "UPDATE message_reports SET status='actioned' WHERE message_id=? AND status='open'",
        )
        .run(messageId);
      this.db
        .prepare(
          "UPDATE alert_events SET status='acknowledged',handled_by=?,handled_at=? WHERE message_id=? AND status='open'",
        )
        .run(userId, now, messageId);
      audit(this.db, userId, "message.hidden", messageId, now);
    })();
    this.bus.publish(row.room_id, {
      type: "removed",
      message_id: messageId,
      seq: row.seq,
    });
    return { hidden: true };
  }

  /** Remove the author of a message from its room and stop them re-joining. */
  banAuthor(userId: string, messageId: string, input: unknown) {
    this.require(userId);
    const { reason } = banSchema.parse(input);
    const now = this.clock();
    const row = this.db
      .prepare("SELECT room_id,user_id FROM messages WHERE id=?")
      .get(messageId) as { room_id: string; user_id: string } | undefined;
    if (!row) throw new AppError(404, "NOT_FOUND", "Message not found.");
    if (row.user_id === userId)
      throw new AppError(400, "OWN_MESSAGE", "You can’t ban yourself.");
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT OR REPLACE INTO room_bans(room_id,user_id,banned_by,reason,created_at) VALUES(?,?,?,?,?)",
        )
        .run(row.room_id, row.user_id, userId, reason ?? null, now);
      this.db
        .prepare("DELETE FROM room_members WHERE room_id=? AND user_id=?")
        .run(row.room_id, row.user_id);
      audit(this.db, userId, "room.banned", row.room_id, now);
    })();
    this.bus.publish(row.room_id, { type: "revoked", user_id: row.user_id });
    return { banned: true };
  }

  hideRating(userId: string, ratingId: string) {
    this.require(userId);
    const now = this.clock();
    const changed = this.db
      .prepare("UPDATE ratings SET status='hidden',updated_at=? WHERE id=?")
      .run(now, ratingId).changes;
    if (!changed) throw new AppError(404, "NOT_FOUND", "Rating not found.");
    this.db
      .prepare(
        "UPDATE rating_reports SET status='actioned' WHERE rating_id=? AND status='open'",
      )
      .run(ratingId);
    audit(this.db, userId, "rating.hidden", ratingId, now);
    return { hidden: true };
  }
}
