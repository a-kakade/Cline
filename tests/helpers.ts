import { randomBytes, randomUUID } from "node:crypto";
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "../src/server/auth";
import { migrate, openDatabase } from "../src/server/database";

export const TEST_ORIGIN = "http://localhost:3000";

export async function createAuthFixture() {
  const db = openDatabase(":memory:");
  try {
    const auth = createAuth(db);
    const migrations = await getMigrations(auth.options);
    await migrations.runMigrations();
    migrate(db);
    return { db, auth, close: () => db.close() };
  } catch (error) {
    db.close();
    throw error;
  }
}

export type AuthFixture = Awaited<ReturnType<typeof createAuthFixture>>;

export function credentials() {
  return {
    name: "Foundation Test User",
    email: `foundation-${randomUUID()}@example.test`,
    password: randomBytes(24).toString("base64url"),
  };
}

export function authRequest(
  fixture: AuthFixture,
  path: string,
  options: { body?: unknown; cookie?: string; origin?: string } = {},
) {
  const headers = new Headers({ origin: options.origin ?? TEST_ORIGIN });
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.body !== undefined)
    headers.set("content-type", "application/json");
  return fixture.auth.handler(
    new Request(`${TEST_ORIGIN}/api/auth/${path}`, {
      method: options.body === undefined ? "GET" : "POST",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  );
}

export function responseCookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

export async function signUp(fixture: AuthFixture, input = credentials()) {
  const response = await authRequest(fixture, "sign-up/email", { body: input });
  if (!response.ok) {
    throw new Error(
      `Fixture signup failed (${response.status}): ${await response.text()}`,
    );
  }
  const result = (await response.json()) as {
    user: { id: string; email: string };
  };
  const cookie = responseCookies(response);
  if (!result.user.id || !cookie)
    throw new Error("Real signup did not issue a session.");
  return { ...input, id: result.user.id, cookie, response };
}
