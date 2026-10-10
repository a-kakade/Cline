import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { areaForPoint } from "../src/lib/geo";
import { ModerationService } from "../src/server/moderation";
import { RatingService } from "../src/server/ratings";
import { RoomBus } from "../src/server/room-bus";
import { RoomService } from "../src/server/rooms";
import { AreaSafetyService } from "../src/server/area-safety";
import { applyRetention } from "../src/server/retention";
import * as rules from "../src/server/triage/rules";
import {
  createAuthFixture,
  signUp,
  TEST_ORIGIN,
  type AuthFixture,
} from "./helpers";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HERE = { lat: 28.6139, lon: 77.209 };
const join = { ...HERE, consent: true };
const REAL = process.env;

describe("area rooms, ratings and moderation with real SQLite", () => {
  let fixture: AuthFixture;
  let now: number;
  let bus: RoomBus;
  let rooms: RoomService;
  let moderation: ModerationService;
  let ratings: RatingService;

  beforeEach(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(48).toString("base64url"));
    vi.stubEnv("BETTER_AUTH_URL", TEST_ORIGIN);
    // These tests create many users; lift only the signup throttle (never honoured in production).
    vi.stubEnv("AUTH_RATE_LIMIT_MAX", "1000");
    fixture = await createAuthFixture();
    now = NOW;
    bus = new RoomBus();
    const secret = process.env.BETTER_AUTH_SECRET!;
    rooms = new RoomService(fixture.db, () => now, bus, secret);
    moderation = new ModerationService(fixture.db, () => now, bus, secret);
    ratings = new RatingService(fixture.db, () => now);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fixture?.close();
    void REAL;
  });

  const user = () => signUp(fixture);
  const area = areaForPoint(HERE.lat, HERE.lon);
  const roomId = area.id;
  async function member() {
    const u = await user();
    rooms.join(u.id, join);
    return u;
  }
  const say = (u: { id: string }, body: string, clientId = randomUUID()) =>
    rooms.post(u.id, roomId, { client_id: clientId, body });
  const rows = (sql: string, ...a: unknown[]) =>
    fixture.db.prepare(sql).all(...a) as Record<string, unknown>[];
  async function moderator() {
    const u = await user();
    fixture.db
      .prepare("INSERT INTO user_roles(user_id,role,granted_at) VALUES(?,?,?)")
      .run(u.id, "moderator", now);
    return u;
  }

  describe("deterministic room assignment and membership", () => {
    it("gives every point in a zone the same stable room, centred on the zone, not on the person", async () => {
      const a = await user();
      const b = await user();
      const first = rooms.resolve(a.id, HERE);
      const second = rooms.resolve(b.id, {
        lat: area.center.lat,
        lon: area.center.lon,
      });
      expect(second.id).toBe(first.id);
      expect(first).toMatchObject({
        id: area.id,
        kind: "area",
        radius_m: 250,
        member_count: 0,
        joined: false,
        banned: false,
        area_id: area.id,
      });
      expect(first.center).toEqual(area.center);
      expect(first.center).not.toEqual(HERE); // the zone centre, never the asker's exact position
      expect(first.name).toMatch(/Area near Delhi/);
      const far = rooms.resolve(a.id, { lat: 19.076, lon: 72.8777 });
      expect(far.id).not.toBe(first.id);
      expect(rows("SELECT id FROM rooms")).toHaveLength(2);
    });

    it("requires consent, persists membership without storing the position, and is idempotent", async () => {
      const u = await user();
      expect(() => rooms.join(u.id, HERE)).toThrow(ZodError);
      expect(() => rooms.join(u.id, { ...join, consent: false })).toThrow(
        ZodError,
      );
      const info = rooms.join(u.id, join);
      expect(info).toMatchObject({ joined: true, member_count: 1 });
      expect(rooms.join(u.id, join).member_count).toBe(1);
      const columns = rows("PRAGMA table_info(room_members)").map(
        (c) => c.name,
      );
      expect(columns).toEqual(["room_id", "user_id", "joined_at", "muted"]);
      expect(rooms.mine(u.id).map((r) => r.id)).toEqual([roomId]);
    });

    it("caps how many rooms one user can join, and leaving frees a slot", async () => {
      const u = await user();
      for (let i = 0; i < 5; i++)
        rooms.join(u.id, { lat: 28.6 + i * 0.02, lon: 77.2, consent: true });
      expect(() =>
        rooms.join(u.id, { lat: 28.9, lon: 77.2, consent: true }),
      ).toThrow(expect.objectContaining({ code: "ROOM_LIMIT", status: 409 }));
      rooms.leave(u.id, rooms.mine(u.id)[0].id);
      rooms.join(u.id, { lat: 28.9, lon: 77.2, consent: true });
      expect(rooms.mine(u.id)).toHaveLength(5);
    });

    it("mute is a per-member flag that requires membership", async () => {
      const u = await member();
      expect(rooms.mute(u.id, roomId, true).muted).toBe(true);
      expect(rooms.mute(u.id, roomId, false).muted).toBe(false);
      const outsider = await user();
      expect(() => rooms.mute(outsider.id, roomId, true)).toThrow(
        expect.objectContaining({ code: "NOT_A_MEMBER" }),
      );
    });
  });

  describe("messages", () => {
    it("lets only members post and read, with a clear error for everyone else", async () => {
      const outsider = await user();
      const m = await member();
      say(m, "hello");
      expect(() => say(outsider, "hi")).toThrow(
        expect.objectContaining({ status: 403, code: "NOT_A_MEMBER" }),
      );
      expect(() => rooms.history(outsider.id, roomId)).toThrow(
        expect.objectContaining({ status: 403 }),
      );
      expect(() => rooms.since(outsider.id, roomId, 0)).toThrow(
        expect.objectContaining({ status: 403 }),
      );
      expect(rows("SELECT id FROM messages")).toHaveLength(1);
    });

    it("stores, orders, and returns messages with pseudonyms, never identities or coordinates", async () => {
      const a = await member();
      const b = await member();
      const r1 = say(a, "  Bus stop   lights are\n on  now ");
      now += 1000;
      const r2 = say(b, "good to know");
      expect(r1.message.body).toBe("Bus stop lights are on now");
      expect(r2.message.seq).toBeGreaterThan(r1.message.seq);
      const pageForB = rooms.history(b.id, roomId);
      expect(pageForB.messages.map((m) => [m.body, m.mine])).toEqual([
        ["Bus stop lights are on now", false],
        ["good to know", true],
      ]);
      expect(pageForB.self_alias).toMatch(/^Member [0-9a-f]{6}$/);
      expect(pageForB.messages[0].alias).not.toBe(pageForB.self_alias);
      const wire = JSON.stringify(pageForB);
      for (const secret of [
        a.id,
        b.id,
        a.email,
        b.email,
        "28.61",
        "77.20",
        "latitude",
        "longitude",
      ])
        expect(wire).not.toContain(secret);
      // The alias is stable per room and differs between rooms.
      expect(rooms.alias(roomId, a.id)).toBe(rooms.alias(roomId, a.id));
      expect(rooms.alias(roomId, a.id)).not.toBe(rooms.alias("g500:1:1", a.id));
    });

    it("paginates history with a cursor and bounded page size", async () => {
      const a = await member();
      for (let i = 0; i < 7; i++) {
        now += 5000; // stay under the per-minute limit
        say(a, `message ${i}`);
        if (i % 15 === 14) now += MIN;
      }
      const page1 = rooms.history(a.id, roomId, { limit: 3 });
      expect(page1.messages.map((m) => m.body)).toEqual([
        "message 4",
        "message 5",
        "message 6",
      ]);
      expect(page1.next_before).not.toBeNull();
      const page2 = rooms.history(a.id, roomId, {
        limit: 3,
        before: page1.next_before!,
      });
      expect(page2.messages.map((m) => m.body)).toEqual([
        "message 1",
        "message 2",
        "message 3",
      ]);
      const page3 = rooms.history(a.id, roomId, {
        limit: 3,
        before: page2.next_before!,
      });
      expect(page3.messages.map((m) => m.body)).toEqual(["message 0"]);
      expect(page3.next_before).toBeNull();
      expect(() => rooms.history(a.id, roomId, { limit: 500 })).toThrow(
        ZodError,
      );
      expect(rooms.history(a.id, roomId, { limit: 50 }).messages).toHaveLength(
        7,
      );
    });

    it("returns an empty room cleanly", async () => {
      const a = await member();
      expect(rooms.history(a.id, roomId)).toMatchObject({
        messages: [],
        next_before: null,
      });
    });

    it("validates and sanitises on the server", async () => {
      const a = await member();
      expect(() => say(a, "   \n\t ")).toThrow(
        expect.objectContaining({ code: "EMPTY_MESSAGE" }),
      );
      expect(() => say(a, "x".repeat(501))).toThrow(
        expect.objectContaining({ code: "TOO_LONG" }),
      );
      expect(() => say(a, "x".repeat(2001))).toThrow(ZodError);
      expect(() =>
        rooms.post(a.id, roomId, { client_id: "nope", body: "hi" }),
      ).toThrow(ZodError);
      expect(() =>
        rooms.post(a.id, roomId, {
          client_id: randomUUID(),
          body: "hi",
          user_id: "x",
        }),
      ).toThrow(ZodError);
      expect(() =>
        say(a, "see http://a.example http://b.example http://c.example"),
      ).toThrow(expect.objectContaining({ code: "TOO_MANY_LINKS" }));
      const stripped = say(a, "he\u0000llo‮ wor​ld");
      expect(stripped.message.body).toBe("hello world");
    });

    it("treats a retried send as the same message and refuses a reused id for another room", async () => {
      const a = await member();
      const id = randomUUID();
      const first = say(a, "hello there", id);
      const again = say(a, "hello there", id);
      expect(again.message.id).toBe(first.message.id);
      expect(rows("SELECT id FROM messages")).toHaveLength(1);
      rooms.join(a.id, { lat: 28.7, lon: 77.2, consent: true });
      const other = rooms.mine(a.id).find((r) => r.id !== roomId)!;
      expect(() =>
        rooms.post(a.id, other.id, { client_id: id, body: "hello there" }),
      ).toThrow(expect.objectContaining({ code: "CLIENT_ID_REUSED" }));
    });

    it("blocks spam: identical repeats and bursts", async () => {
      const a = await member();
      say(a, "same text");
      expect(() => say(a, "same text")).toThrow(
        expect.objectContaining({ code: "DUPLICATE_MESSAGE", status: 409 }),
      );
      now += 61_000;
      say(a, "same text");
      for (let i = 0; i < 19; i++) say(a, `burst ${i}`);
      expect(() => say(a, "one too many")).toThrow(
        expect.objectContaining({ status: 429, code: "RATE_LIMIT" }),
      );
      now += 61_000;
      say(a, "after the window");
    });

    it("lets a user block an author (without learning who they are) and unblock by alias", async () => {
      const a = await member();
      const b = await member();
      const bad = say(b, "annoying message");
      say(a, "my own");
      expect(() => rooms.block(a.id, say(a, "again").message.id)).toThrow(
        expect.objectContaining({ code: "OWN_MESSAGE" }),
      );
      const result = rooms.block(a.id, bad.message.id);
      expect(result.alias).toBe(rooms.alias(roomId, b.id));
      expect(
        rooms.history(a.id, roomId).messages.map((m) => m.body),
      ).not.toContain("annoying message");
      expect(rooms.history(b.id, roomId).messages.map((m) => m.body)).toContain(
        "my own",
      ); // others unaffected
      expect(rooms.blockedAliases(a.id, roomId)).toEqual([result.alias]);
      expect(
        rooms.unblock(a.id, { room_id: roomId, alias: result.alias }),
      ).toEqual({ unblocked: true });
      expect(rooms.history(a.id, roomId).messages.map((m) => m.body)).toContain(
        "annoying message",
      );
      expect(
        rooms.unblock(a.id, { room_id: roomId, alias: "Member 000000" }),
      ).toEqual({ unblocked: false });
    });

    it("reports a message once per reporter, never your own, and only from inside the room", async () => {
      const a = await member();
      const b = await member();
      const outsider = await user();
      const msg = say(a, "rude").message;
      expect(() => rooms.report(a.id, msg.id, { reason: "abuse" })).toThrow(
        expect.objectContaining({ code: "OWN_MESSAGE" }),
      );
      expect(() =>
        rooms.report(outsider.id, msg.id, { reason: "abuse" }),
      ).toThrow(expect.objectContaining({ status: 403 }));
      expect(() => rooms.report(b.id, msg.id, { reason: "boring" })).toThrow(
        ZodError,
      );
      expect(() =>
        rooms.report(b.id, randomUUID(), { reason: "abuse" }),
      ).toThrow(expect.objectContaining({ status: 404 }));
      rooms.report(b.id, msg.id, { reason: "abuse" });
      rooms.report(b.id, msg.id, { reason: "spam" });
      expect(rows("SELECT id FROM message_reports")).toHaveLength(1);
    });

    it("deletes messages after 30 days along with their triage rows and alerts", async () => {
      const a = await member();
      say(a, "someone is following me please help");
      expect(rows("SELECT message_id FROM triage_results")).toHaveLength(1);
      expect(rows("SELECT id FROM alert_events")).toHaveLength(1);
      applyRetention(fixture.db, now + 29 * 86_400_000);
      expect(rows("SELECT id FROM messages")).toHaveLength(1);
      applyRetention(fixture.db, now + 31 * 86_400_000);
      expect(rows("SELECT id FROM messages")).toHaveLength(0);
      expect(rows("SELECT message_id FROM triage_results")).toHaveLength(0);
      expect(rows("SELECT id FROM alert_events")).toHaveLength(0);
    });
  });

  describe("safety triage and the controlled alert policy", () => {
    it("shows the sender help options and flags urgent messages for moderators only", async () => {
      const a = await member();
      const b = await member();
      const result = say(a, "Someone is following me please help");
      expect(result.triage).toMatchObject({
        category: "urgent_safety_concern",
        flagged_for_review: true,
        suggested_actions: ["call_112", "open_sos", "nearby_help"],
      });
      // Other members see the message and nothing about its classification.
      const seenByB = rooms.history(b.id, roomId).messages[0];
      expect(Object.keys(seenByB).sort()).toEqual([
        "alias",
        "body",
        "created_at",
        "id",
        "mine",
        "room_id",
        "seq",
        "status",
      ]);
      const alert = rows("SELECT * FROM alert_events")[0];
      expect(alert).toMatchObject({
        category: "urgent_safety_concern",
        priority: "urgent",
        status: "open",
        room_id: roomId,
      });
      expect(Object.keys(alert)).not.toEqual(
        expect.arrayContaining(["latitude"]),
      );
      expect(
        rows("PRAGMA table_info(alert_events)")
          .map((c) => c.name)
          .join(),
      ).not.toMatch(/lat|lon|phone/);
      // No emergency alert, delivery or provider call is ever created from a message.
      expect(rows("SELECT id FROM alerts")).toHaveLength(0);
      expect(rows("SELECT id FROM deliveries")).toHaveLength(0);
    });

    it("creates no alert for general chat, hazards or mild concerns", async () => {
      const a = await member();
      for (const text of [
        "good morning neighbours",
        "The street light is not working on this lane",
        "avoid the back lane tonight",
      ]) {
        now += 10_000;
        expect(say(a, text).triage).not.toBeNull();
      }
      expect(rows("SELECT id FROM alert_events")).toHaveLength(0);
      expect(
        rows("SELECT category FROM triage_results ORDER BY created_at").map(
          (r) => r.category,
        ),
      ).toEqual(["general", "infrastructure_hazard", "concern"]);
    });

    it("deduplicates repeated urgent messages from one author within the window", async () => {
      const a = await member();
      say(a, "someone is following me please help");
      now += 10_000;
      say(a, "he is still following me help me");
      expect(rows("SELECT id FROM alert_events")).toHaveLength(1);
      now += 11 * MIN;
      say(a, "he is still following me help");
      expect(rows("SELECT id FROM alert_events")).toHaveLength(2);
    });

    it("rolls review-level reports from different people into one queue entry per 30 minutes", async () => {
      const a = await member();
      const b = await member();
      say(a, "a guy passed lewd comments at me");
      say(b, "someone harassed me near the station too");
      expect(rows("SELECT category,priority FROM alert_events")).toEqual([
        { category: "harassment_report", priority: "review" },
      ]);
    });

    it("caps alerts per author, so one person cannot flood moderators", async () => {
      const spammer = await member();
      for (let i = 0; i < 5; i++) {
        now += 11 * MIN; // beyond the 10-minute dedupe bucket, so only the cooldown limits it
        say(spammer, `help me someone is following me ${i}`);
      }
      // Messages are all stored and triaged; only the moderator-queue entries are limited.
      expect(rows("SELECT id FROM messages")).toHaveLength(5);
      expect(
        rows("SELECT id FROM alert_events WHERE author_id=?", spammer.id),
      ).toHaveLength(3);
    });

    it("caps urgent alerts per room per hour, however many people trigger them", async () => {
      for (let i = 0; i < 8; i++) {
        const u = await member();
        now += MIN;
        say(u, "someone is following me please help");
      }
      expect(rows("SELECT id FROM messages")).toHaveLength(8);
      expect(
        rows("SELECT id FROM alert_events WHERE priority='urgent'"),
      ).toHaveLength(5);
      now += 61 * MIN; // the window rolls forward
      const late = await member();
      say(late, "someone is following me please help");
      expect(
        rows("SELECT id FROM alert_events WHERE priority='urgent'"),
      ).toHaveLength(6);
    });

    it("never loses a message when triage fails", async () => {
      const a = await member();
      vi.spyOn(rules, "triageByRules").mockImplementation(() => {
        throw new Error("classifier crashed");
      });
      const result = say(a, "someone is following me please help");
      expect(result.triage).toBeNull();
      expect(result.message.body).toBe("someone is following me please help");
      expect(rows("SELECT id FROM messages")).toHaveLength(1);
      expect(rows("SELECT id FROM alert_events")).toHaveLength(0);
    });

    it("does not let an alert insert failure undo or hide the message", async () => {
      const a = await member();
      fixture.db.exec("DROP TABLE alert_events");
      const result = say(a, "someone is following me please help");
      expect(result.message.body).toBeTruthy();
      expect(result.triage).toBeNull();
      expect(rooms.history(a.id, roomId).messages).toHaveLength(1);
    });
  });

  describe("moderation", () => {
    it("is closed to everyone without the moderator role", async () => {
      const a = await member();
      const msg = say(a, "someone is following me please help").message;
      const alertId = rows("SELECT id FROM alert_events")[0].id as string;
      const calls: (() => unknown)[] = [
        () => moderation.queue(a.id),
        () => moderation.handleAlert(a.id, alertId, { status: "acknowledged" }),
        () =>
          moderation.handleReport(a.id, randomUUID(), { status: "dismissed" }),
        () => moderation.hideMessage(a.id, msg.id),
        () => moderation.banAuthor(a.id, msg.id, {}),
        () => moderation.hideRating(a.id, randomUUID()),
      ];
      for (const call of calls)
        expect(call).toThrow(
          expect.objectContaining({ status: 403, code: "FORBIDDEN" }),
        );
      expect(rows("SELECT status FROM messages")).toEqual([
        { status: "visible" },
      ]);
    });

    it("gives moderators an urgent-first queue with the message, an alias and an honest note", async () => {
      const mod = await moderator();
      const a = await member();
      const b = await member();
      say(b, "a guy passed lewd comments at me");
      say(a, "someone is following me please help");
      const queue = moderation.queue(mod.id);
      expect(queue.alerts.map((x) => x.priority)).toEqual(["urgent", "review"]);
      expect(queue.alerts[0]).toMatchObject({
        category: "urgent_safety_concern",
        body: "someone is following me please help",
        alias: rooms.alias(roomId, a.id),
        room_id: roomId,
      });
      expect(queue.alerts[0].note).toMatch(/miss many real emergencies/);
      expect(JSON.stringify(queue)).not.toContain(a.id);
      expect(JSON.stringify(queue)).not.toContain(a.email);
    });

    it("acknowledges or dismisses an alert once, and audits it without message content", async () => {
      const mod = await moderator();
      const a = await member();
      say(a, "someone is following me please help");
      const alertId = rows("SELECT id FROM alert_events")[0].id as string;
      expect(
        moderation.handleAlert(mod.id, alertId, { status: "acknowledged" }),
      ).toEqual({ status: "acknowledged" });
      expect(() =>
        moderation.handleAlert(mod.id, alertId, { status: "dismissed" }),
      ).toThrow(expect.objectContaining({ status: 404 }));
      expect(() =>
        moderation.handleAlert(mod.id, alertId, { status: "bogus" }),
      ).toThrow(ZodError);
      expect(moderation.queue(mod.id).alerts).toHaveLength(0);
      const audit = JSON.stringify(
        rows("SELECT action,resource_id FROM audit_events"),
      );
      expect(audit).toContain("alert.acknowledged");
      expect(audit).not.toContain("following");
    });

    it("hides a message for everyone, tells live subscribers, and closes its reports and alerts", async () => {
      const mod = await moderator();
      const a = await member();
      const b = await member();
      const msg = say(a, "someone is following me please help").message;
      rooms.report(b.id, msg.id, { reason: "unsafe_info" });
      const events: unknown[] = [];
      bus.subscribe(roomId, (e) => events.push(e));
      moderation.hideMessage(mod.id, msg.id);
      expect(events).toEqual([
        { type: "removed", message_id: msg.id, seq: msg.seq },
      ]);
      const seen = rooms.history(b.id, roomId).messages[0];
      expect(seen).toMatchObject({ status: "hidden", body: null });
      expect(rows("SELECT status FROM message_reports")).toEqual([
        { status: "actioned" },
      ]);
      expect(rows("SELECT status FROM alert_events")).toEqual([
        { status: "acknowledged" },
      ]);
    });

    it("bans an author: removes membership, blocks re-joining, and revokes live streams", async () => {
      const mod = await moderator();
      const bad = await member();
      const good = await member();
      const msg = say(bad, "spam spam").message;
      const events: unknown[] = [];
      bus.subscribe(roomId, (e) => events.push(e));
      expect(() =>
        moderation.banAuthor(mod.id, msg.id, { reason: "x".repeat(300) }),
      ).toThrow(ZodError);
      moderation.banAuthor(mod.id, msg.id, { reason: "spam" });
      expect(events).toEqual([{ type: "revoked", user_id: bad.id }]);
      expect(() => rooms.history(bad.id, roomId)).toThrow(
        expect.objectContaining({ status: 403 }),
      );
      expect(() => say(bad, "still here?")).toThrow(
        expect.objectContaining({ status: 403 }),
      );
      expect(() => rooms.join(bad.id, join)).toThrow(
        expect.objectContaining({ code: "ROOM_BANNED" }),
      );
      expect(rooms.resolve(bad.id, HERE).banned).toBe(true);
      expect(rooms.history(good.id, roomId).messages).toHaveLength(1); // good members unaffected
      expect(() =>
        moderation.banAuthor(mod.id, say(mod, "me").message.id, {}),
      ).toThrow();
    });
  });

  describe("area ratings and reviews", () => {
    it("shows no average until enough people have rated, then separates day and night", async () => {
      const users = await Promise.all([1, 2, 3, 4, 5].map(() => user()));
      for (const [i, u] of users.slice(0, 4).entries())
        ratings.upsert(u.id, area.id, {
          stars: 5 - (i % 2),
          day_stars: 5,
          night_stars: 2,
        });
      let s = ratings.summary(users[0].id, area.id);
      expect(s.overall).toEqual({ average: null, count: 4, shown: false });
      expect(s.min_to_show).toBe(5);
      s = ratings.upsert(users[4].id, area.id, { stars: 3, day_stars: 4 });
      expect(s.overall).toEqual({ average: 4.2, count: 5, shown: true }); // (5+4+5+4+3)/5
      expect(s.day).toEqual({ average: 4.8, count: 5, shown: true });
      expect(s.night).toEqual({ average: null, count: 4, shown: false });
      expect(s.distribution).toEqual([0, 0, 1, 2, 2]);
      expect(s.count_last_90_days).toBe(5);
      expect(s.disclaimer).toMatch(/not verified incidents/);
      expect(s.disclaimer).toMatch(/does not prove an area is safe/);
    });

    it("keeps one rating per user per area, updates in place, and lets users delete it", async () => {
      const u = await user();
      ratings.upsert(u.id, area.id, {
        stars: 2,
        review: "poorly lit at night",
      });
      now += 5000;
      const s = ratings.upsert(u.id, area.id, {
        stars: 4,
        review: "better now",
      });
      expect(rows("SELECT id FROM ratings")).toHaveLength(1);
      expect(s.my_rating).toEqual({
        stars: 4,
        day_stars: null,
        night_stars: null,
        review: "better now",
      });
      expect(s.reviews).toEqual([
        expect.objectContaining({ stars: 4, review: "better now", mine: true }),
      ]);
      expect(ratings.remove(u.id, area.id).my_rating).toBeNull();
      expect(rows("SELECT id FROM ratings")).toHaveLength(0);
    });

    it("validates stars, review length, contact details, areas and limits", async () => {
      const u = await user();
      for (const bad of [
        { stars: 0 },
        { stars: 6 },
        { stars: 2.5 },
        { stars: 3, day_stars: 9 },
        { stars: 3, extra: 1 },
        { stars: 3, review: "x".repeat(1001) },
      ])
        expect(() => ratings.upsert(u.id, area.id, bad)).toThrow(ZodError);
      expect(() =>
        ratings.upsert(u.id, area.id, { stars: 3, review: "x".repeat(281) }),
      ).toThrow(expect.objectContaining({ code: "TOO_LONG" }));
      for (const text of [
        "call me 98765 43210 for details",
        "write to me@example.org",
        "+91-9876543210",
      ])
        expect(() =>
          ratings.upsert(u.id, area.id, { stars: 3, review: text }),
        ).toThrow(expect.objectContaining({ code: "CONTACT_DETAILS" }));
      expect(() => ratings.upsert(u.id, "not-an-area", { stars: 3 })).toThrow(
        expect.objectContaining({ code: "INVALID_AREA" }),
      );
      expect(() => ratings.summary(u.id, "g500:abc")).toThrow(
        expect.objectContaining({ code: "INVALID_AREA" }),
      );
      expect(rows("SELECT id FROM ratings")).toHaveLength(0);
    });

    it("rate-limits writes per minute and new ratings per day", async () => {
      const u = await user();
      for (let i = 0; i < 10; i++)
        ratings.upsert(u.id, areaForPoint(28.6 + i * 0.01, 77.2).id, {
          stars: 4,
        });
      expect(() =>
        ratings.upsert(u.id, areaForPoint(28.9, 77.2).id, { stars: 4 }),
      ).toThrow(expect.objectContaining({ status: 429 }));
      for (let i = 10; i < 20; i++) {
        now += 61_000;
        ratings.upsert(u.id, areaForPoint(28.6 + i * 0.01, 77.2).id, {
          stars: 4,
        });
      }
      now += 61_000;
      expect(() =>
        ratings.upsert(u.id, areaForPoint(30, 77.2).id, { stars: 4 }),
      ).toThrow(expect.objectContaining({ code: "RATE_LIMIT" }));
    });

    it("supports abuse reports and moderator removal, which changes the aggregate", async () => {
      const mod = await moderator();
      const author = await user();
      const reader = await user();
      ratings.upsert(author.id, area.id, {
        stars: 1,
        review: "nasty insult here",
      });
      const ratingId = rows("SELECT id FROM ratings")[0].id as string;
      expect(() =>
        ratings.report(author.id, ratingId, { reason: "abuse" }),
      ).toThrow(expect.objectContaining({ code: "OWN_RATING" }));
      expect(() =>
        ratings.report(reader.id, randomUUID(), { reason: "abuse" }),
      ).toThrow(expect.objectContaining({ status: 404 }));
      ratings.report(reader.id, ratingId, { reason: "abuse" });
      ratings.report(reader.id, ratingId, { reason: "spam" });
      expect(moderation.queue(mod.id).rating_reports).toEqual([
        expect.objectContaining({
          rating_id: ratingId,
          reason: "abuse",
          review: "nasty insult here",
        }),
      ]);
      moderation.hideRating(mod.id, ratingId);
      const s = ratings.summary(reader.id, area.id);
      expect(s.overall.count).toBe(0);
      expect(s.reviews).toEqual([]);
      expect(moderation.queue(mod.id).rating_reports).toEqual([]);
      // The author cannot resurrect a hidden rating by editing it.
      ratings.upsert(author.id, area.id, { stars: 1, review: "still nasty" });
      expect(ratings.summary(reader.id, area.id).reviews).toEqual([]);
    });

    it("keeps community ratings separate from incident data in the area summary", async () => {
      const users = await Promise.all([1, 2, 3, 4, 5].map(() => user()));
      for (const u of users) ratings.upsert(u.id, area.id, { stars: 1 });
      const summary = new AreaSafetyService(fixture.db, () => now).summarize(
        users[0].id,
        HERE,
      );
      expect(summary.signals.community_ratings).toEqual({
        status: "ok",
        average: 1,
        count: 5,
      });
      // Terrible ratings do not create "incidents" or move the report-based indicator.
      expect(summary.signals.verified_incidents.count).toBe(0);
      expect(summary.signals.unverified_reports.count).toBe(0);
      expect(summary.indicator).toMatchObject({
        level: "insufficient_data",
        points: null,
      });
      ratings.remove(users[4].id, area.id);
      expect(
        new AreaSafetyService(fixture.db, () => now).summarize(
          users[0].id,
          HERE,
        ).signals.community_ratings.status,
      ).toBe("insufficient");
    });
  });
});
