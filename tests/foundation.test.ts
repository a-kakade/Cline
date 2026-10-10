import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as authModule from "../src/server/auth";
import { config } from "../src/server/config";
import { migrate } from "../src/server/database";
import {
  AppError,
  body,
  endpoint,
  json,
  requireUser,
} from "../src/server/http";
import {
  authRequest,
  createAuthFixture,
  credentials,
  responseCookies,
  signUp,
  TEST_ORIGIN,
  type AuthFixture,
} from "./helpers";

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(48).toString("base64url"));
  vi.stubEnv("BETTER_AUTH_URL", TEST_ORIGIN);
  vi.stubEnv("DATABASE_PATH", ":memory:");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("foundation configuration", () => {
  it("accepts random local secrets and normalizes the origin", () => {
    vi.stubEnv("BETTER_AUTH_URL", `${TEST_ORIGIN}/auth`);
    expect(config()).toMatchObject({
      url: TEST_ORIGIN,
      databasePath: ":memory:",
    });
  });

  it.each(["", "too-short", "replace-with-at-least-32-random-characters"])(
    "rejects an unsafe secret: %s",
    (secret) => {
      vi.stubEnv("BETTER_AUTH_SECRET", secret);
      expect(() => config()).toThrow(/BETTER_AUTH_SECRET/);
    },
  );

  it("requires an explicit auth URL", () => {
    vi.stubEnv("BETTER_AUTH_URL", "");
    expect(() => config()).toThrow(/BETTER_AUTH_URL/);
  });

  it("rejects remote HTTP origins in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_URL", "http://sakhi.example.test");
    expect(() => config()).toThrow("Production requires HTTPS.");
    vi.stubEnv("BETTER_AUTH_URL", "https://sakhi.example.test");
    expect(config().url).toBe("https://sakhi.example.test");
  });
});

describe("real Better Auth and ownership foundation", () => {
  let fixture: AuthFixture;

  beforeEach(async () => {
    fixture = await createAuthFixture();
    // Only select the isolated instance. Authentication, password verification,
    // database sessions and cookie signatures remain real Better Auth behavior.
    vi.spyOn(authModule, "getAuth").mockReturnValue(fixture.auth);
  });

  afterEach(() => fixture?.close());

  it("migrates auth before app tables and safely reapplies app migrations", async () => {
    const authContext = await fixture.auth.$context;
    expect(authContext.skipOriginCheck).toBe(false);
    expect(authContext.skipCSRFCheck).toBe(false);
    expect(fixture.db.pragma("foreign_keys", { simple: true })).toBe(1);
    const before = fixture.db
      .prepare("SELECT name FROM schema_migrations ORDER BY name")
      .all();
    expect(before).toContainEqual({ name: "001_foundation.sql" });
    migrate(fixture.db);
    expect(
      fixture.db
        .prepare("SELECT name FROM schema_migrations ORDER BY name")
        .all(),
    ).toEqual(before);
    const tables = fixture.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all();
    expect(tables).toEqual(
      expect.arrayContaining([
        { name: "user" },
        { name: "session" },
        { name: "account" },
        { name: "audit_events" },
        { name: "request_limits" },
      ]),
    );
  });

  it("persists a signup with a hashed password and an HttpOnly session cookie", async () => {
    const user = await signUp(fixture);
    expect(user.response.headers.getSetCookie().join(";")).toMatch(/HttpOnly/i);
    expect(user.response.headers.getSetCookie().join(";")).toMatch(
      /SameSite=Lax/i,
    );
    const account = fixture.db
      .prepare('SELECT password FROM account WHERE "userId" = ?')
      .get(user.id) as { password: string };
    expect(account.password).toBeTruthy();
    expect(account.password).not.toBe(user.password);
    const session = await authRequest(fixture, "get-session", {
      cookie: user.cookie,
    });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      user: { id: user.id, email: user.email },
      session: { userId: user.id },
    });
  });

  it("allows frequent session hydration but enforces the separate read-only quota", async () => {
    const user = await signUp(fixture);
    for (let count = 0; count < 300; count++) {
      const response = await fixture.auth.handler(
        new Request(`${TEST_ORIGIN}/api/auth/get-session`, {
          headers: { cookie: user.cookie, "x-forwarded-for": "192.0.2.15" },
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ user: { id: user.id } });
    }
    const rejected = await fixture.auth.handler(
      new Request(`${TEST_ORIGIN}/api/auth/get-session`, {
        headers: { cookie: user.cookie, "x-forwarded-for": "192.0.2.15" },
      }),
    );
    expect(rejected.status).toBe(429);
    expect(fixture.auth.options.rateLimit).toMatchObject({
      enabled: true,
      max: 30,
      window: 60,
    });
  });

  it("rejects passwords shorter than the server's 12-character minimum", async () => {
    const response = await authRequest(fixture, "sign-up/email", {
      body: { ...credentials(), password: "ShortPass12" },
    });
    expect(response.ok).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(fixture.db.prepare("SELECT id FROM user").all()).toEqual([]);
  });

  it("does not create a second user for a duplicate email", async () => {
    const user = await signUp(fixture);
    const response = await authRequest(fixture, "sign-up/email", {
      body: { name: user.name, email: user.email, password: user.password },
    });
    expect(response.ok).toBe(false);
    expect(fixture.db.prepare("SELECT id FROM user").all()).toEqual([
      { id: user.id },
    ]);
  });

  it("rejects a wrong password and authenticates the correct password", async () => {
    const user = await signUp(fixture);
    const rejected = await authRequest(fixture, "sign-in/email", {
      body: { email: user.email, password: "AnIncorrectPassword123!" },
    });
    expect(rejected.status).toBe(401);
    expect(responseCookies(rejected)).not.toContain("session_token=");
    const accepted = await authRequest(fixture, "sign-in/email", {
      body: { email: user.email, password: user.password },
    });
    expect(accepted.status).toBe(200);
    const session = await authRequest(fixture, "get-session", {
      cookie: responseCookies(accepted),
    });
    expect(await session.json()).toMatchObject({ user: { id: user.id } });
  });

  it("revokes the actual persisted session on signout", async () => {
    const user = await signUp(fixture);
    const response = await authRequest(fixture, "sign-out", {
      body: {},
      cookie: user.cookie,
    });
    expect(response.status).toBe(200);
    const session = await authRequest(fixture, "get-session", {
      cookie: user.cookie,
    });
    expect(await session.json()).toBeNull();
    expect(
      fixture.db
        .prepare('SELECT id FROM session WHERE "userId" = ?')
        .all(user.id),
    ).toEqual([]);
    await expect(
      requireUser(
        new Request(TEST_ORIGIN, { headers: { cookie: user.cookie } }),
      ),
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });

  it("rejects cross-origin signup at the actual auth handler", async () => {
    const response = await authRequest(fixture, "sign-up/email", {
      body: credentials(),
      origin: "https://attacker.example.test",
    });
    expect(response.status).toBe(403);
    expect(fixture.db.prepare("SELECT id FROM user").all()).toEqual([]);
  });

  it("does not authorize missing or forged session cookies", async () => {
    for (const cookie of [
      "",
      "better-auth.session_token=forged.invalid-signature",
    ]) {
      await expect(
        requireUser(new Request(TEST_ORIGIN, { headers: { cookie } })),
      ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    }
  });

  it("derives each owner from their verified session, not supplied user IDs", async () => {
    const alice = await signUp(fixture);
    const bob = await signUp(fixture);
    expect(alice.id).not.toBe(bob.id);
    const request = new Request(
      `${TEST_ORIGIN}/api/foundation?userId=${bob.id}`,
      {
        method: "POST",
        headers: {
          cookie: alice.cookie,
          origin: TEST_ORIGIN,
          "content-type": "application/json",
          "x-user-id": bob.id,
        },
        body: JSON.stringify({ userId: bob.id }),
      },
    );
    await expect(requireUser(request)).resolves.toBe(alice.id);
    await expect(
      requireUser(
        new Request(TEST_ORIGIN, { headers: { cookie: bob.cookie } }),
      ),
    ).resolves.toBe(bob.id);
  });

  it("rejects mutation requests with missing or untrusted origins even with a valid session", async () => {
    const user = await signUp(fixture);
    for (const origin of [undefined, "https://attacker.example.test"]) {
      const headers = new Headers({ cookie: user.cookie });
      if (origin) headers.set("origin", origin);
      await expect(
        requireUser(new Request(TEST_ORIGIN, { method: "POST", headers })),
      ).rejects.toMatchObject({ status: 403, code: "ORIGIN" });
    }
  });

  it("enforces foreign-key ownership for foundation audit records", async () => {
    const insert = fixture.db.prepare(
      "INSERT INTO audit_events (id, user_id, action, resource_id, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    expect(() =>
      insert.run(
        "orphan",
        "missing-user",
        "foundation.test",
        "test",
        Date.now(),
      ),
    ).toThrow(/FOREIGN KEY/);
    const user = await signUp(fixture);
    insert.run("owned", user.id, "foundation.test", "test", Date.now());
    fixture.db.prepare("DELETE FROM user WHERE id = ?").run(user.id);
    expect(fixture.db.prepare("SELECT id FROM audit_events").all()).toEqual([]);
  });
});

describe("foundation HTTP contracts", () => {
  function jsonRequest(value: string, contentType = "application/json") {
    return new Request(TEST_ORIGIN, {
      method: "POST",
      headers: { "content-type": contentType },
      body: value,
    });
  }

  it("returns non-cacheable success envelopes", async () => {
    const response = json({ ready: true }, 201);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: { ready: true } });
  });

  it("preserves safe application errors", async () => {
    const response = await endpoint(() => {
      throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Sign in to continue." },
    });
  });

  it("converts validation errors to a 400 response", async () => {
    const response = await endpoint(() =>
      json(z.object({ email: z.email() }).parse({ email: "invalid" })),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });

  it("never exposes internal exception details", async () => {
    const response = await endpoint(() => {
      throw new Error("secret database path and credentials");
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.text();
    expect(payload).toContain("Emergency calling remains available");
    expect(payload).not.toContain("secret database");
  });

  it("parses valid JSON including UTF-8", async () => {
    await expect(body(jsonRequest('{"name":"सखी"}'))).resolves.toEqual({
      name: "सखी",
    });
  });

  it("rejects wrong media types, missing bodies, and malformed JSON", async () => {
    await expect(body(jsonRequest("{}", "text/plain"))).rejects.toMatchObject({
      status: 415,
      code: "CONTENT_TYPE",
    });
    await expect(
      body(
        new Request(TEST_ORIGIN, {
          method: "POST",
          headers: { "content-type": "application/json" },
        }),
      ),
    ).rejects.toMatchObject({ status: 400, code: "BODY" });
    await expect(body(jsonRequest("{"))).rejects.toMatchObject({
      status: 400,
      code: "JSON",
    });
  });

  it("limits request bytes rather than JavaScript character count", async () => {
    await expect(
      body(jsonRequest(JSON.stringify("a".repeat(16382)))),
    ).resolves.toHaveLength(16382);
    await expect(
      body(jsonRequest(JSON.stringify("a".repeat(16383)))),
    ).rejects.toMatchObject({ status: 413, code: "TOO_LARGE" });
    await expect(
      body(jsonRequest(JSON.stringify("स".repeat(6000)))),
    ).rejects.toMatchObject({ status: 413, code: "TOO_LARGE" });
  });
});
