import type Database from "better-sqlite3";
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { areaForPoint, haversineMeters } from "@/lib/geo";
import { CITY_CENTRES } from "@/lib/map-client";
import type {
  HistoryPage,
  PostResult,
  RoomInfo,
  RoomMessage,
} from "@/lib/room-types";
import type { TriageResult } from "@/lib/triage-types";
import { evaluateAlert } from "./alert-policy";
import { audit, throttle } from "./audit";
import { AppError } from "./http";
import { getRoomBus, type RoomBus } from "./room-bus";
import { triageByRules } from "./triage/rules";

const MAX_ROOMS_PER_USER = 5;
const PAGE_DEFAULT = 30;
const PAGE_MAX = 50;
const DUPLICATE_WINDOW_MS = 60_000;

const position = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  })
  .strict();
export const joinSchema = position
  .extend({ consent: z.literal(true) })
  .strict();
export const postSchema = z
  .object({ client_id: z.uuid(), body: z.string().max(2000) })
  .strict();
const historySchema = z
  .object({
    before: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(PAGE_MAX).default(PAGE_DEFAULT),
  })
  .strict();
const reportSchema = z
  .object({
    reason: z.enum(["abuse", "spam", "unsafe_info", "privacy", "other"]),
  })
  .strict();

const clean = (v: string) =>
  v
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();

type MessageRow = {
  seq: number;
  id: string;
  room_id: string;
  user_id: string;
  body: string;
  status: "visible" | "hidden";
  created_at: number;
};
type RoomRow = {
  id: string;
  kind: "area" | "venue";
  name: string;
  center_lat: number;
  center_lon: number;
  radius_m: number;
};

export function areaName(center: { lat: number; lon: number }) {
  const nearest = CITY_CENTRES.map((c) => ({
    c,
    d: haversineMeters(center, c),
  })).sort((a, b) => a.d - b.d)[0];
  return nearest.d < 40_000
    ? `Area near ${nearest.c.name} (${center.lat.toFixed(3)}, ${center.lon.toFixed(3)})`
    : `Area at ${center.lat.toFixed(3)}, ${center.lon.toFixed(3)}`;
}

export class RoomService {
  constructor(
    private db: Database.Database,
    private clock = Date.now,
    private bus: RoomBus = getRoomBus(),
    private secret = process.env.BETTER_AUTH_SECRET ?? "",
  ) {}

  /** A stable pseudonym for a member inside one room. */
  alias(roomId: string, userId: string) {
    return `Member ${createHmac("sha256", this.secret).update(`${roomId}|${userId}`).digest("hex").slice(0, 6)}`;
  }

  private row(roomId: string): RoomRow | undefined {
    return this.db
      .prepare(
        "SELECT id,kind,name,center_lat,center_lon,radius_m FROM rooms WHERE id=?",
      )
      .get(roomId) as RoomRow | undefined;
  }
  private info(userId: string, room: RoomRow): RoomInfo {
    const member = this.db
      .prepare("SELECT muted FROM room_members WHERE room_id=? AND user_id=?")
      .get(room.id, userId) as { muted: number } | undefined;
    const banned = !!this.db
      .prepare("SELECT 1 FROM room_bans WHERE room_id=? AND user_id=?")
      .get(room.id, userId);
    const count = this.db
      .prepare("SELECT COUNT(*) AS n FROM room_members WHERE room_id=?")
      .get(room.id) as { n: number };
    return {
      id: room.id,
      kind: room.kind,
      name: room.name,
      center: { lat: room.center_lat, lon: room.center_lon },
      radius_m: room.radius_m,
      member_count: count.n,
      joined: !!member,
      muted: !!member?.muted,
      banned,
      area_id: room.kind === "area" ? room.id : null,
    };
  }
  private ensureAreaRoom(lat: number, lon: number): RoomRow {
    const area = areaForPoint(lat, lon);
    const existing = this.row(area.id);
    if (existing) return existing;
    this.db
      .prepare(
        "INSERT OR IGNORE INTO rooms(id,kind,name,center_lat,center_lon,radius_m,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        area.id,
        "area",
        areaName(area.center),
        area.center.lat,
        area.center.lon,
        Math.round(area.size_m / 2),
        this.clock(),
      );
    return this.row(area.id)!;
  }

  /** Which fixed room covers this position? Read-only apart from creating the room record. */
  resolve(userId: string, input: unknown): RoomInfo {
    const p = position.parse(input);
    throttle(this.db, userId, "rooms", 60, this.clock());
    return this.info(userId, this.ensureAreaRoom(p.lat, p.lon));
  }

  /**
   * Join the room for the area containing the given position. The position is
   * self-reported (a browser cannot prove where it is) and is NOT stored; only the
   * resulting room membership is.
   */
  join(userId: string, input: unknown): RoomInfo {
    const p = joinSchema.parse(input);
    throttle(this.db, userId, "room-join", 10, this.clock());
    return this.db
      .transaction(() => {
        const room = this.ensureAreaRoom(p.lat, p.lon);
        if (
          this.db
            .prepare("SELECT 1 FROM room_bans WHERE room_id=? AND user_id=?")
            .get(room.id, userId)
        )
          throw new AppError(403, "ROOM_BANNED", "You can’t join this room.");
        const already = this.db
          .prepare("SELECT 1 FROM room_members WHERE room_id=? AND user_id=?")
          .get(room.id, userId);
        if (!already) {
          const mine = this.db
            .prepare("SELECT COUNT(*) AS n FROM room_members WHERE user_id=?")
            .get(userId) as { n: number };
          if (mine.n >= MAX_ROOMS_PER_USER)
            throw new AppError(
              409,
              "ROOM_LIMIT",
              `You can be in up to ${MAX_ROOMS_PER_USER} area rooms. Leave one first.`,
            );
          this.db
            .prepare(
              "INSERT INTO room_members(room_id,user_id,joined_at) VALUES(?,?,?)",
            )
            .run(room.id, userId, this.clock());
          audit(this.db, userId, "room.joined", room.id, this.clock());
        }
        return this.info(userId, room);
      })
      .immediate();
  }

  leave(userId: string, roomId: string) {
    this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM room_members WHERE room_id=? AND user_id=?")
        .run(roomId, userId);
      audit(this.db, userId, "room.left", roomId, this.clock());
    })();
    this.bus.publish(roomId, { type: "revoked", user_id: userId });
  }

  mine(userId: string): RoomInfo[] {
    const ids = this.db
      .prepare(
        "SELECT room_id FROM room_members WHERE user_id=? ORDER BY joined_at",
      )
      .all(userId) as { room_id: string }[];
    return ids.map(({ room_id }) => this.info(userId, this.row(room_id)!));
  }

  mute(userId: string, roomId: string, muted: boolean) {
    this.requireMember(userId, roomId);
    this.db
      .prepare("UPDATE room_members SET muted=? WHERE room_id=? AND user_id=?")
      .run(+muted, roomId, userId);
    return this.info(userId, this.row(roomId)!);
  }

  /** Throws 403 unless the user is a current, non-banned member. Used by every read and write. */
  requireMember(userId: string, roomId: string) {
    const ok = this.db
      .prepare(
        `SELECT 1 FROM room_members m WHERE m.room_id=? AND m.user_id=?
         AND NOT EXISTS (SELECT 1 FROM room_bans b WHERE b.room_id=m.room_id AND b.user_id=m.user_id)`,
      )
      .get(roomId, userId);
    if (!ok)
      throw new AppError(
        403,
        "NOT_A_MEMBER",
        "Join this area room to read or post messages.",
      );
  }

  private blockedIds(userId: string) {
    return new Set(
      (
        this.db
          .prepare("SELECT blocked_id FROM user_blocks WHERE blocker_id=?")
          .all(userId) as { blocked_id: string }[]
      ).map((r) => r.blocked_id),
    );
  }
  toPublic(viewerId: string, row: MessageRow): RoomMessage {
    return {
      id: row.id,
      seq: row.seq,
      room_id: row.room_id,
      alias: this.alias(row.room_id, row.user_id),
      body: row.status === "visible" ? row.body : null,
      status: row.status,
      created_at: row.created_at,
      mine: row.user_id === viewerId,
    };
  }

  history(userId: string, roomId: string, query: unknown = {}): HistoryPage {
    const q = historySchema.parse(query);
    this.requireMember(userId, roomId);
    throttle(this.db, userId, "room-read", 120, this.clock());
    const blocked = this.blockedIds(userId);
    const rows = this.db
      .prepare(
        `SELECT seq,id,room_id,user_id,body,status,created_at FROM messages
         WHERE room_id=? AND (? IS NULL OR seq<?) ORDER BY seq DESC LIMIT ?`,
      )
      .all(
        roomId,
        q.before ?? null,
        q.before ?? null,
        q.limit + 1,
      ) as MessageRow[];
    const more = rows.length > q.limit;
    const page = rows
      .slice(0, q.limit)
      .filter((r) => !blocked.has(r.user_id) || r.user_id === userId);
    return {
      messages: page.reverse().map((r) => this.toPublic(userId, r)),
      self_alias: this.alias(roomId, userId),
      next_before: more ? rows[q.limit - 1].seq : null,
    };
  }

  /** For stream replay after a reconnect. */
  since(
    userId: string,
    roomId: string,
    afterSeq: number,
    limit = 100,
  ): RoomMessage[] {
    this.requireMember(userId, roomId);
    const blocked = this.blockedIds(userId);
    return (
      this.db
        .prepare(
          `SELECT seq,id,room_id,user_id,body,status,created_at FROM messages WHERE room_id=? AND seq>? ORDER BY seq LIMIT ?`,
        )
        .all(roomId, afterSeq, limit) as MessageRow[]
    )
      .filter((r) => !blocked.has(r.user_id) || r.user_id === userId)
      .map((r) => this.toPublic(userId, r));
  }

  post(userId: string, roomId: string, input: unknown): PostResult {
    const data = postSchema.parse(input);
    const body = clean(data.body);
    if (!body)
      throw new AppError(400, "EMPTY_MESSAGE", "Write a message first.");
    if (body.length > 500)
      throw new AppError(
        400,
        "TOO_LONG",
        "Messages can be up to 500 characters.",
      );
    if ((body.match(/https?:\/\/|www\./gi) ?? []).length > 2)
      throw new AppError(
        400,
        "TOO_MANY_LINKS",
        "Please share at most two links per message.",
      );
    const now = this.clock();
    const stored = this.db
      .transaction(() => {
        this.requireMember(userId, roomId);
        const replay = this.db
          .prepare(
            "SELECT seq,id,room_id,user_id,body,status,created_at FROM messages WHERE user_id=? AND client_id=?",
          )
          .get(userId, data.client_id) as MessageRow | undefined;
        if (replay) {
          if (replay.room_id !== roomId)
            throw new AppError(
              409,
              "CLIENT_ID_REUSED",
              "That request id was used for another room.",
            );
          return { row: replay, fresh: false };
        }
        throttle(this.db, userId, "room-post", 20, now);
        const dup = this.db
          .prepare(
            "SELECT 1 FROM messages WHERE room_id=? AND user_id=? AND body=? AND created_at>?",
          )
          .get(roomId, userId, body, now - DUPLICATE_WINDOW_MS);
        if (dup)
          throw new AppError(
            409,
            "DUPLICATE_MESSAGE",
            "You just sent that. Wait a moment before repeating it.",
          );
        const id = randomUUID();
        const inserted = this.db
          .prepare(
            "INSERT INTO messages(id,room_id,user_id,client_id,body,status,created_at) VALUES(?,?,?,?,?,'visible',?)",
          )
          .run(id, roomId, userId, data.client_id, body, now);
        const row: MessageRow = {
          seq: Number(inserted.lastInsertRowid),
          id,
          room_id: roomId,
          user_id: userId,
          body,
          status: "visible",
          created_at: now,
        };
        return { row, fresh: true };
      })
      .immediate();

    let triage: TriageResult | null = null;
    if (stored.fresh) {
      // Triage and alerting must never block or fail a message.
      try {
        triage = triageByRules(body);
        const t = triage;
        this.db.transaction(() => {
          this.db
            .prepare(
              "INSERT OR IGNORE INTO triage_results(message_id,category,language,strength,reason,needs_review,method,created_at) VALUES(?,?,?,?,?,?,?,?)",
            )
            .run(
              stored.row.id,
              t.category,
              t.language,
              t.strength,
              t.reason,
              +t.needs_review,
              t.method,
              now,
            );
          evaluateAlert(this.db, {
            roomId,
            messageId: stored.row.id,
            authorId: userId,
            triage: t,
            now,
          });
        })();
      } catch {
        triage = null;
      }
      this.bus.publish(roomId, {
        type: "message",
        seq: stored.row.seq,
        id: stored.row.id,
        room_id: roomId,
        author_id: userId,
        body: stored.row.body,
        created_at: stored.row.created_at,
      });
    } else {
      const saved = this.db
        .prepare(
          "SELECT category,language,strength,reason,needs_review,method FROM triage_results WHERE message_id=?",
        )
        .get(stored.row.id) as
        | {
            category: TriageResult["category"];
            language: string;
            strength: TriageResult["strength"];
            reason: string;
            needs_review: number;
          }
        | undefined;
      if (saved)
        triage = {
          ...saved,
          needs_review: !!saved.needs_review,
          method: "rules",
          suggested_actions: triageByRules(stored.row.body).suggested_actions,
        };
    }
    return {
      message: this.toPublic(userId, stored.row),
      triage: triage && {
        category: triage.category,
        strength: triage.strength,
        reason: triage.reason,
        language: triage.language,
        suggested_actions: triage.suggested_actions,
        flagged_for_review: triage.needs_review,
      },
    };
  }

  private messageRow(messageId: string) {
    return this.db
      .prepare(
        "SELECT seq,id,room_id,user_id,body,status,created_at FROM messages WHERE id=?",
      )
      .get(messageId) as MessageRow | undefined;
  }

  report(userId: string, messageId: string, input: unknown) {
    const { reason } = reportSchema.parse(input);
    const message = this.messageRow(messageId);
    if (!message) throw new AppError(404, "NOT_FOUND", "Message not found.");
    this.requireMember(userId, message.room_id);
    if (message.user_id === userId)
      throw new AppError(
        400,
        "OWN_MESSAGE",
        "You can’t report your own message.",
      );
    throttle(this.db, userId, "message-report", 20, this.clock());
    this.db
      .prepare(
        "INSERT OR IGNORE INTO message_reports(id,message_id,reporter_id,reason,status,created_at) VALUES(?,?,?,?, 'open',?)",
      )
      .run(randomUUID(), messageId, userId, reason, this.clock());
    audit(this.db, userId, "message.reported", messageId, this.clock());
    return { reported: true };
  }

  block(userId: string, messageId: string) {
    const message = this.messageRow(messageId);
    if (!message) throw new AppError(404, "NOT_FOUND", "Message not found.");
    this.requireMember(userId, message.room_id);
    if (message.user_id === userId)
      throw new AppError(400, "OWN_MESSAGE", "You can’t block yourself.");
    this.db
      .prepare(
        "INSERT OR IGNORE INTO user_blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)",
      )
      .run(userId, message.user_id, this.clock());
    audit(this.db, userId, "user.blocked", message.room_id, this.clock());
    return {
      blocked: true,
      alias: this.alias(message.room_id, message.user_id),
    };
  }
  unblock(userId: string, input: unknown) {
    const { room_id, alias } = z
      .object({ room_id: z.string().max(40), alias: z.string().max(20) })
      .strict()
      .parse(input);
    const blocked = this.db
      .prepare("SELECT blocked_id FROM user_blocks WHERE blocker_id=?")
      .all(userId) as { blocked_id: string }[];
    const target = blocked.find(
      (b) => this.alias(room_id, b.blocked_id) === alias,
    );
    if (target)
      this.db
        .prepare("DELETE FROM user_blocks WHERE blocker_id=? AND blocked_id=?")
        .run(userId, target.blocked_id);
    return { unblocked: !!target };
  }
  blockedAliases(userId: string, roomId: string) {
    this.requireMember(userId, roomId);
    return [...this.blockedIds(userId)].map((id) => this.alias(roomId, id));
  }
  isBlockedBy(viewerId: string, authorId: string) {
    return this.blockedIds(viewerId).has(authorId);
  }
}
