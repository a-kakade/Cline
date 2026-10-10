import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/server/auth";
import { openDatabase } from "../src/server/database";

function limits() {
  const db = openDatabase(":memory:");
  try {
    const rateLimit = createAuth(db).options.rateLimit!;
    return {
      max: rateLimit.max,
      rules: rateLimit.customRules as Record<
        string,
        { window: number; max: number }
      >,
    };
  } finally {
    db.close();
  }
}

describe("authentication rate limits", () => {
  beforeEach(() => {
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(48).toString("base64url"));
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses the strict defaults when nothing is overridden", () => {
    const { max, rules } = limits();
    expect(max).toBe(30);
    expect(Object.keys(rules)).toEqual(["/get-session"]);
  });

  it("ignores AUTH_RATE_LIMIT_MAX in production so the E2E relaxation can never ship", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_RATE_LIMIT_MAX", "100000");
    const { max, rules } = limits();
    expect(max).toBe(30);
    expect(Object.keys(rules)).toEqual(["/get-session"]);
  });

  it("honours the override only outside production and never below the default", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_RATE_LIMIT_MAX", "1000");
    let result = limits();
    expect(result.max).toBe(1000);
    expect(result.rules["/sign-up/*"]).toEqual({ window: 10, max: 1000 });
    expect(result.rules["/sign-in/*"]).toEqual({ window: 10, max: 1000 });
    vi.stubEnv("AUTH_RATE_LIMIT_MAX", "5");
    result = limits();
    expect(result.max).toBe(30);
    expect(Object.keys(result.rules)).toEqual(["/get-session"]);
  });
});
