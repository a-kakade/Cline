import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { areaForPoint } from "../src/lib/geo";
import * as authModule from "../src/server/auth";
import * as databaseModule from "../src/server/database";
import { ModerationService } from "../src/server/moderation";
import { getRoomBus, RoomBus } from "../src/server/room-bus";
import { openRoomStream } from "../src/server/room-stream";
import { RoomService } from "../src/server/rooms";
import { GET as streamRoute } from "../src/app/api/rooms/[id]/stream/route";
import {
  GET as historyRoute,
  POST as postRoute,
} from "../src/app/api/rooms/[id]/messages/route";
import { POST as joinRoute } from "../src/app/api/rooms/join/route";
import { POST as resolveRoute } from "../src/app/api/rooms/resolve/route";
import { GET as modQueue } from "../src/app/api/moderation/queue/route";
import {
  createAuthFixture,
  signUp,
  TEST_ORIGIN,
  type AuthFixture,
} from "./helpers";

const HERE = { lat: 28.6139, lon: 77.209 };
const roomId = areaForPoint(HERE.lat, HERE.lon).id;
const dec = new TextDecoder();

// Collects SSE frames from a stream until `count` frames (excluding comments) arrive.
async function frames(
  stream: ReadableStream<Uint8Array>,
  count: number,
  timeoutMs = 2000,
) {
  const reader = stream.getReader();
  const out: { event: string; id?: string; data: unknown }[] = [];
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  while (out.length < count && Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((r) =>
        setTimeout(() => r({ done: true, value: undefined }), 100),
      ),
    ]);
    if (chunk.value) buffer += dec.decode(chunk.value);
    if (chunk.done && !chunk.value && out.length >= count) break;
    for (const block of buffer.split("\n\n").slice(0, -1)) {
      const event = /event: (.*)/.exec(block)?.[1];
      if (event)
        out.push({
          event,
          id: /id: (.*)/.exec(block)?.[1],
          data: JSON.parse(/data: (.*)/.exec(block)![1]),
        });
    }
    buffer = buffer.slice(
      buffer.lastIndexOf("\n\n") + 2 > 1 ? buffer.lastIndexOf("\n\n") + 2 : 0,
    );
    if (chunk.done && !chunk.value) {
      if (reader) break;
    }
  }
  reader.releaseLock();
  return out;
}

describe("room realtime stream", () => {
  let fixture: AuthFixture;
  let now: number;
  let bus: RoomBus;
  let rooms: RoomService;

  beforeEach(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(48).toString("base64url"));
    vi.stubEnv("BETTER_AUTH_URL", TEST_ORIGIN);
    vi.stubEnv("DATABASE_PATH", ":memory:");
    vi.stubEnv("AUTH_RATE_LIMIT_MAX", "1000");
    fixture = await createAuthFixture();
    now = 1_800_000_000_000;
    bus = new RoomBus();
    rooms = new RoomService(
      fixture.db,
      () => now,
      bus,
      process.env.BETTER_AUTH_SECRET!,
    );
    vi.spyOn(authModule, "getAuth").mockReturnValue(fixture.auth);
    vi.spyOn(databaseModule, "getDatabase").mockReturnValue(fixture.db);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    fixture?.close();
  });

  async function member() {
    const u = await signUp(fixture);
    rooms.join(u.id, { ...HERE, consent: true });
    return u;
  }
  const say = (u: { id: string }, body: string) =>
    rooms.post(u.id, roomId, { client_id: randomUUID(), body });

  it("refuses to open for a non-member, before any stream exists", async () => {
    const outsider = await signUp(fixture);
    expect(() => openRoomStream(rooms, bus, outsider.id, roomId, null)).toThrow(
      expect.objectContaining({ status: 403, code: "NOT_A_MEMBER" }),
    );
    expect(bus.listenerCount(roomId)).toBe(0);
  });

  it("delivers a new message live to other members with an alias, not an identity", async () => {
    const a = await member();
    const b = await member();
    const controller = new AbortController();
    const stream = openRoomStream(rooms, bus, b.id, roomId, null, {
      signal: controller.signal,
    });
    const pending = frames(stream, 2);
    say(a, "streetlight is out near the gate");
    const [ready, message] = await pending;
    expect(ready).toMatchObject({
      event: "ready",
      data: { room_id: roomId, self_alias: rooms.alias(roomId, b.id) },
    });
    expect(message.event).toBe("message");
    expect(message.data).toMatchObject({
      body: "streetlight is out near the gate",
      alias: rooms.alias(roomId, a.id),
      mine: false,
      status: "visible",
    });
    expect(message.id).toBe(String((message.data as { seq: number }).seq));
    const wire = JSON.stringify([ready, message]);
    for (const secret of [a.id, b.id, a.email, b.email, "latitude", "28.61"])
      expect(wire).not.toContain(secret);
    controller.abort();
    expect(bus.listenerCount(roomId)).toBe(0);
  });

  it("marks the sender's own live messages as theirs and never leaks triage to the room", async () => {
    const a = await member();
    const b = await member();
    const s = openRoomStream(rooms, bus, b.id, roomId, null);
    const pending = frames(s, 2);
    say(a, "someone is following me please help");
    const [, message] = await pending;
    expect(Object.keys(message.data as object).sort()).toEqual([
      "alias",
      "body",
      "created_at",
      "id",
      "mine",
      "room_id",
      "seq",
      "status",
    ]);
  });

  it("replays everything missed after a reconnect using the last event id", async () => {
    const a = await member();
    const b = await member();
    const first = say(a, "one").message;
    now += 1000;
    say(a, "two");
    now += 1000;
    say(a, "three");
    const stream = openRoomStream(rooms, bus, b.id, roomId, first.seq);
    const got = await frames(stream, 3);
    expect(got.map((f) => f.event)).toEqual(["ready", "message", "message"]);
    expect(got.slice(1).map((f) => (f.data as { body: string }).body)).toEqual([
      "two",
      "three",
    ]);
    // A live message arriving after the replay is delivered once, not duplicated.
    const live = openRoomStream(rooms, bus, b.id, roomId, first.seq);
    const pending = frames(live, 4);
    now += 1000;
    say(a, "four");
    expect(
      (await pending)
        .map((f) => (f.data as { body?: string }).body)
        .filter(Boolean),
    ).toEqual(["two", "three", "four"]);
  });

  it("does not deliver messages from authors the viewer blocked, and still delivers the viewer's own", async () => {
    const a = await member();
    const b = await member();
    const c = await member();
    const blockedMsg = say(a, "rude").message;
    rooms.block(b.id, blockedMsg.id);
    const stream = openRoomStream(rooms, bus, b.id, roomId, null);
    const pending = frames(stream, 3);
    now += 1000;
    say(a, "more rude");
    say(c, "friendly");
    const got = await pending;
    expect(
      got
        .filter((f) => f.event === "message")
        .map((f) => (f.data as { body: string }).body),
    ).toEqual(["friendly"]);
  });

  it("tells subscribers when a moderator removes a message", async () => {
    const mod = await signUp(fixture);
    fixture.db
      .prepare(
        "INSERT INTO user_roles(user_id,role,granted_at) VALUES(?, 'moderator', ?)",
      )
      .run(mod.id, now);
    const a = await member();
    const b = await member();
    const msg = say(a, "bad").message;
    const stream = openRoomStream(rooms, bus, b.id, roomId, msg.seq);
    const pending = frames(stream, 2);
    new ModerationService(
      fixture.db,
      () => now,
      bus,
      process.env.BETTER_AUTH_SECRET!,
    ).hideMessage(mod.id, msg.id);
    const got = await pending;
    expect(got[1]).toEqual({
      event: "removed",
      id: undefined,
      data: { message_id: msg.id, seq: msg.seq },
    });
  });

  it("ends the stream when the member is banned or leaves, and stops delivering", async () => {
    const mod = await signUp(fixture);
    fixture.db
      .prepare(
        "INSERT INTO user_roles(user_id,role,granted_at) VALUES(?, 'moderator', ?)",
      )
      .run(mod.id, now);
    const a = await member();
    const bad = await member();
    const msg = say(bad, "spam").message;
    const stream = openRoomStream(rooms, bus, bad.id, roomId, msg.seq);
    const pending = frames(stream, 2);
    new ModerationService(
      fixture.db,
      () => now,
      bus,
      process.env.BETTER_AUTH_SECRET!,
    ).banAuthor(mod.id, msg.id, {});
    const got = await pending;
    expect(got.map((f) => f.event)).toEqual(["ready", "closed"]);
    expect(got[1].data).toEqual({ reason: "membership_ended" });
    expect(bus.listenerCount(roomId)).toBe(0);
    say(a, "after the ban"); // nothing is delivered to the banned user's closed stream

    const leaver = await member();
    const s2 = openRoomStream(rooms, bus, leaver.id, roomId, null);
    const p2 = frames(s2, 2);
    rooms.leave(leaver.id, roomId);
    expect((await p2).map((f) => f.event)).toEqual(["ready", "closed"]);
  });

  it("re-checks membership on every heartbeat even if no event arrives", async () => {
    vi.useFakeTimers();
    const a = await member();
    const stream = openRoomStream(rooms, bus, a.id, roomId, null, {
      heartbeatMs: 1000,
    });
    const reader = stream.getReader();
    await reader.read(); // retry
    await reader.read(); // ready
    fixture.db.prepare("DELETE FROM room_members WHERE user_id=?").run(a.id); // revoked behind the stream's back
    await vi.advanceTimersByTimeAsync(1100);
    const closing = await reader.read();
    expect(dec.decode(closing.value)).toContain("event: closed");
    expect((await reader.read()).done).toBe(true);
    expect(bus.listenerCount(roomId)).toBe(0);
  });

  it("sends ping events to healthy members so clients can detect a dead connection", async () => {
    vi.useFakeTimers();
    const a = await member();
    const stream = openRoomStream(rooms, bus, a.id, roomId, null, {
      heartbeatMs: 1000,
    });
    const reader = stream.getReader();
    await reader.read();
    await reader.read();
    await vi.advanceTimersByTimeAsync(1100);
    expect(dec.decode((await reader.read()).value)).toMatch(
      /^event: ping\ndata: \{"t":\d+\}\n\n$/,
    );
    await reader.cancel();
    expect(bus.listenerCount(roomId)).toBe(0);
  });

  it("isolates a broken subscriber from the others", () => {
    const seen: string[] = [];
    bus.subscribe("r", () => {
      throw new Error("boom");
    });
    bus.subscribe("r", (e) => seen.push(e.type));
    bus.publish("r", { type: "revoked", user_id: "x" });
    expect(seen).toEqual(["revoked"]);
  });

  describe("over HTTP with real sessions", () => {
    vi.stubEnv("NODE_ENV", "test");
    const req = (
      method: string,
      path: string,
      opts: {
        cookie?: string;
        input?: unknown;
        headers?: Record<string, string>;
        signal?: AbortSignal;
      } = {},
    ) => {
      const headers = new Headers({
        "content-type": "application/json",
        origin: TEST_ORIGIN,
        ...opts.headers,
      });
      if (opts.cookie) headers.set("cookie", opts.cookie);
      return new Request(`${TEST_ORIGIN}${path}`, {
        method,
        headers,
        body: opts.input === undefined ? undefined : JSON.stringify(opts.input),
        signal: opts.signal,
      });
    };
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

    it("requires a session; non-members get 403 for read, post and stream; members succeed", async () => {
      const alice = await signUp(fixture);
      const mallory = await signUp(fixture);
      const joined = await joinRoute(
        req("POST", "/api/rooms/join", {
          cookie: alice.cookie,
          input: { ...HERE, consent: true },
        }),
      );
      expect(joined.status).toBe(200);
      const id = (await joined.json()).data.id as string;
      expect(id).toBe(roomId);

      for (const call of [
        () => historyRoute(req("GET", `/api/rooms/${id}/messages`), ctx(id)),
        () =>
          postRoute(
            req("POST", `/api/rooms/${id}/messages`, {
              input: { client_id: randomUUID(), body: "hi" },
            }),
            ctx(id),
          ),
        () => streamRoute(req("GET", `/api/rooms/${id}/stream`), ctx(id)),
      ])
        expect((await call()).status).toBe(401);
      for (const call of [
        () =>
          historyRoute(
            req("GET", `/api/rooms/${id}/messages`, { cookie: mallory.cookie }),
            ctx(id),
          ),
        () =>
          postRoute(
            req("POST", `/api/rooms/${id}/messages`, {
              cookie: mallory.cookie,
              input: { client_id: randomUUID(), body: "hi" },
            }),
            ctx(id),
          ),
        () =>
          streamRoute(
            req("GET", `/api/rooms/${id}/stream`, { cookie: mallory.cookie }),
            ctx(id),
          ),
      ]) {
        const res = await call();
        expect(res.status).toBe(403);
        expect((await res.json()).error.code).toBe("NOT_A_MEMBER");
      }

      const posted = await postRoute(
        req("POST", `/api/rooms/${id}/messages`, {
          cookie: alice.cookie,
          input: { client_id: randomUUID(), body: "hello area" },
        }),
        ctx(id),
      );
      expect(posted.status).toBe(201);
      const history = await (
        await historyRoute(
          req("GET", `/api/rooms/${id}/messages?limit=10`, {
            cookie: alice.cookie,
          }),
          ctx(id),
        )
      ).json();
      expect(
        history.data.messages.map((m: { body: string }) => m.body),
      ).toEqual(["hello area"]);

      const controller = new AbortController();
      const live = await streamRoute(
        req("GET", `/api/rooms/${id}/stream`, {
          cookie: alice.cookie,
          signal: controller.signal,
        }),
        ctx(id),
      );
      expect(live.status).toBe(200);
      expect(live.headers.get("content-type")).toMatch(/text\/event-stream/);
      expect(live.headers.get("cache-control")).toMatch(/no-store/);
      const reader = live.body!.getReader();
      expect(dec.decode((await reader.read()).value)).toContain("retry:");
      expect(dec.decode((await reader.read()).value)).toContain("event: ready");
      controller.abort();
      expect(getRoomBus().listenerCount(id)).toBe(0);
    });

    it("rejects cross-origin writes, malformed positions and an invalid Last-Event-ID safely", async () => {
      const alice = await signUp(fixture);
      const evil = await resolveRoute(
        req("POST", "/api/rooms/resolve", {
          cookie: alice.cookie,
          headers: { origin: "https://evil.example" },
          input: HERE,
        }),
      );
      expect(evil.status).toBe(403);
      const bad = await resolveRoute(
        req("POST", "/api/rooms/resolve", {
          cookie: alice.cookie,
          input: { lat: 200, lon: 0 },
        }),
      );
      expect(bad.status).toBe(400);
      await joinRoute(
        req("POST", "/api/rooms/join", {
          cookie: alice.cookie,
          input: { ...HERE, consent: true },
        }),
      );
      const res = await streamRoute(
        req("GET", `/api/rooms/${roomId}/stream`, {
          cookie: alice.cookie,
          headers: { "last-event-id": "-1; DROP TABLE messages" },
        }),
        ctx(roomId),
      );
      expect(res.status).toBe(200);
      await res.body!.cancel();
      expect(
        fixture.db.prepare("SELECT COUNT(*) AS n FROM messages").get(),
      ).toEqual({ n: 0 });
    });

    it("hides the moderation queue from ordinary users", async () => {
      const alice = await signUp(fixture);
      const res = await modQueue(
        req("GET", "/api/moderation/queue", { cookie: alice.cookie }),
      );
      expect(res.status).toBe(403);
    });
  });
});
