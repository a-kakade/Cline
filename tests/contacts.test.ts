import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMigrations } from "better-auth/db/migration";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import * as authModule from "../src/server/auth";
import * as databaseModule from "../src/server/database";
import { ContactService } from "../src/server/contacts";
import { GET, POST } from "../src/app/api/contacts/route";
import { DELETE, PATCH } from "../src/app/api/contacts/[id]/route";
import {
  createAuthFixture,
  signUp,
  TEST_ORIGIN,
  type AuthFixture,
} from "./helpers";

const contactInput = {
  name: "  Asha Rao  ",
  phone_number: "98765 43210",
  relationship: "  Sister  ",
};

let fixture: AuthFixture;

beforeEach(async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(48).toString("base64url"));
  vi.stubEnv("BETTER_AUTH_URL", TEST_ORIGIN);
  vi.stubEnv("DATABASE_PATH", ":memory:");
  fixture = await createAuthFixture();
  // Redirect only factories. Passwords, cookies, sessions, auth middleware,
  // route handlers, contact services and the migrated SQLite database are real.
  vi.spyOn(authModule, "getAuth").mockReturnValue(fixture.auth);
  vi.spyOn(databaseModule, "getDatabase").mockReturnValue(fixture.db);
});

afterEach(() => {
  vi.restoreAllMocks();
  fixture?.close();
  vi.unstubAllEnvs();
});

function contactRequest(
  method: string,
  options: {
    cookie?: string;
    input?: unknown;
    id?: string;
    origin?: string | null;
  } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.origin !== null)
    headers.set("origin", options.origin ?? TEST_ORIGIN);
  return new Request(
    `${TEST_ORIGIN}/api/contacts${options.id ? `/${options.id}` : ""}`,
    {
      method,
      headers,
      body:
        options.input === undefined ? undefined : JSON.stringify(options.input),
    },
  );
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("ContactService with real migrated SQLite", () => {
  it("normalizes Indian phone numbers, trims names and defaults alerts off", async () => {
    const user = await signUp(fixture);
    const service = new ContactService(fixture.db, () => 1_800_000_000_000);
    const contact = service.create(user.id, contactInput);
    expect(contact).toEqual({
      id: expect.any(String),
      user_id: user.id,
      name: "Asha Rao",
      phone_number: "+919876543210",
      relationship: "Sister",
      alert_enabled: false,
      created_at: 1_800_000_000_000,
      updated_at: 1_800_000_000_000,
    });
    expect(service.list(user.id)).toEqual([contact]);
    expect(
      fixture.db
        .prepare("SELECT alert_enabled FROM contacts WHERE id = ?")
        .get(contact.id),
    ).toEqual({ alert_enabled: 0 });
  });

  it("supports explicit international numbers and an omitted relationship", async () => {
    const user = await signUp(fixture);
    const contact = new ContactService(fixture.db).create(user.id, {
      name: "Alex",
      phone_number: "+1 202-555-0123",
    });
    expect(contact).toMatchObject({
      phone_number: "+12025550123",
      relationship: null,
      alert_enabled: false,
    });
  });

  it("updates all editable fields and preserves identity and creation time", async () => {
    const user = await signUp(fixture);
    let now = 1_800_000_000_000;
    const service = new ContactService(fixture.db, () => now);
    const before = service.create(user.id, contactInput);
    now += 1_000;
    const enabled = service.update(user.id, before.id, {
      name: "Asha Updated",
      phone_number: "+91 98765 43211",
      relationship: "Friend",
      alert_enabled: true,
    });
    expect(enabled).toMatchObject({
      id: before.id,
      user_id: user.id,
      created_at: before.created_at,
      updated_at: now,
      name: "Asha Updated",
      phone_number: "+919876543211",
      relationship: "Friend",
      alert_enabled: true,
    });
    const disabled = service.update(user.id, before.id, {
      name: enabled.name,
      phone_number: enabled.phone_number,
      relationship: "",
      alert_enabled: false,
    });
    expect(disabled).toMatchObject({
      relationship: null,
      alert_enabled: false,
    });
    expect(service.delete(user.id, before.id)).toEqual({ deleted: true });
    expect(service.list(user.id)).toEqual([]);
    expect(() => service.get(user.id, before.id)).toThrow(
      expect.objectContaining({ status: 404, code: "NOT_FOUND" }),
    );
  });

  it("scopes listing and direct reads to the authenticated owner", async () => {
    const alice = await signUp(fixture);
    const bob = await signUp(fixture);
    const service = new ContactService(fixture.db);
    const contact = service.create(alice.id, contactInput);
    expect(service.list(bob.id)).toEqual([]);
    expect(() => service.get(bob.id, contact.id)).toThrow(
      expect.objectContaining({ status: 404, code: "NOT_FOUND" }),
    );
    expect(service.get(alice.id, contact.id)).toEqual(contact);
  });

  it("prevents another owner from updating or deleting a contact", async () => {
    const alice = await signUp(fixture);
    const bob = await signUp(fixture);
    const service = new ContactService(fixture.db);
    const contact = service.create(alice.id, contactInput);
    expect(() =>
      service.update(bob.id, contact.id, { ...contactInput, name: "Hijacked" }),
    ).toThrow(expect.objectContaining({ status: 404, code: "NOT_FOUND" }));
    expect(() => service.delete(bob.id, contact.id)).toThrow(
      expect.objectContaining({ status: 404, code: "NOT_FOUND" }),
    );
    expect(service.get(alice.id, contact.id)).toEqual(contact);
    expect(
      fixture.db
        .prepare("SELECT id FROM audit_events WHERE user_id = ?")
        .all(bob.id),
    ).toEqual([]);
  });

  it("rejects normalized duplicates per owner but permits the same phone for another owner", async () => {
    const alice = await signUp(fixture);
    const bob = await signUp(fixture);
    const service = new ContactService(fixture.db);
    const first = service.create(alice.id, contactInput);
    expect(() =>
      service.create(alice.id, {
        ...contactInput,
        phone_number: "+91 98765-43210",
      }),
    ).toThrow(
      expect.objectContaining({ status: 409, code: "DUPLICATE_CONTACT" }),
    );
    expect(service.update(alice.id, first.id, contactInput).id).toBe(first.id);
    expect(service.create(bob.id, contactInput).user_id).toBe(bob.id);
    const second = service.create(alice.id, {
      ...contactInput,
      phone_number: "9876543211",
    });
    expect(() => service.update(alice.id, second.id, contactInput)).toThrow(
      expect.objectContaining({ status: 409, code: "DUPLICATE_CONTACT" }),
    );
    expect(service.get(alice.id, second.id).phone_number).toBe("+919876543211");
  });

  it.each([
    ["blank name", { name: "   " }],
    ["long name", { name: "a".repeat(81) }],
    ["missing phone", { phone_number: "" }],
    ["invalid phone", { phone_number: "not a phone" }],
    [
      "embedded phone in arbitrary text",
      { phone_number: "Call me at 9876543210" },
    ],
    ["short number", { phone_number: "112" }],
    ["long relationship", { relationship: "a".repeat(61) }],
    ["nonboolean alert flag", { alert_enabled: "true" }],
    ["ownership injection", { user_id: "another-user" }],
  ])("rejects %s before persisting anything", async (_label, input) => {
    const user = await signUp(fixture);
    const service = new ContactService(fixture.db);
    expect(() =>
      service.create(user.id, { ...contactInput, ...input }),
    ).toThrow(ZodError);
    expect(service.list(user.id)).toEqual([]);
    expect(fixture.db.prepare("SELECT id FROM audit_events").all()).toEqual([]);
  });

  it("accepts the maximum name and relationship lengths", async () => {
    const user = await signUp(fixture);
    const contact = new ContactService(fixture.db).create(user.id, {
      ...contactInput,
      name: "a".repeat(80),
      relationship: "b".repeat(60),
    });
    expect(contact.name).toHaveLength(80);
    expect(contact.relationship).toHaveLength(60);
  });

  it("limits each user to 20 contacts without affecting other users", async () => {
    const alice = await signUp(fixture);
    const bob = await signUp(fixture);
    const service = new ContactService(fixture.db);
    for (let index = 0; index < 20; index++) {
      service.create(alice.id, {
        name: `Contact ${index}`,
        phone_number: `+9198765432${String(index).padStart(2, "0")}`,
      });
    }
    expect(() =>
      service.create(alice.id, {
        name: "Too many",
        phone_number: "+919876543299",
      }),
    ).toThrow(expect.objectContaining({ status: 409, code: "CONTACT_LIMIT" }));
    expect(service.list(alice.id)).toHaveLength(20);
    expect(service.create(bob.id, contactInput).user_id).toBe(bob.id);
  });

  it("throttles writes per user and resets at the next minute", async () => {
    const alice = await signUp(fixture);
    const bob = await signUp(fixture);
    let now = 1_800_000_000_000;
    const service = new ContactService(fixture.db, () => now);
    const contact = service.create(alice.id, contactInput);
    for (let count = 1; count < 60; count++)
      service.update(alice.id, contact.id, contactInput);
    expect(() => service.delete(alice.id, contact.id)).toThrow(
      expect.objectContaining({ status: 429, code: "RATE_LIMIT" }),
    );
    expect(service.get(alice.id, contact.id)).toBeDefined();
    expect(service.create(bob.id, contactInput).user_id).toBe(bob.id);
    now += 60_000;
    expect(service.delete(alice.id, contact.id)).toEqual({ deleted: true });
    expect(service.list(alice.id)).toEqual([]);
  });

  it("records minimal ownership-scoped audit events, not contact details", async () => {
    const user = await signUp(fixture);
    const service = new ContactService(fixture.db, () => 1_800_000_000_000);
    const contact = service.create(user.id, contactInput);
    service.update(user.id, contact.id, {
      ...contactInput,
      alert_enabled: true,
    });
    service.delete(user.id, contact.id);
    const events = fixture.db
      .prepare("SELECT * FROM audit_events WHERE user_id = ? ORDER BY rowid")
      .all(user.id);
    expect(events).toEqual(
      ["contact.created", "contact.updated", "contact.deleted"].map(
        (action) => ({
          id: expect.any(String),
          user_id: user.id,
          action,
          resource_id: contact.id,
          created_at: 1_800_000_000_000,
        }),
      ),
    );
    expect(JSON.stringify(events)).not.toContain("9876543210");
    expect(JSON.stringify(events)).not.toContain("Asha");
  });

  it("persists CRUD across real SQLite connection close and reopen", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sakhi-contacts-test-"));
    const path = join(directory, "contacts.sqlite");
    let db = databaseModule.openDatabase(path);
    try {
      const auth = authModule.createAuth(db);
      await (await getMigrations(auth.options)).runMigrations();
      databaseModule.migrate(db);
      const user = await signUp({ auth, db, close: () => db.close() });
      const contact = new ContactService(db).create(user.id, contactInput);
      db.close();
      db = databaseModule.openDatabase(path);
      expect(new ContactService(db).get(user.id, contact.id)).toEqual(contact);
      new ContactService(db).update(user.id, contact.id, {
        ...contactInput,
        alert_enabled: true,
      });
      db.close();
      db = databaseModule.openDatabase(path);
      expect(
        new ContactService(db).get(user.id, contact.id).alert_enabled,
      ).toBe(true);
      new ContactService(db).delete(user.id, contact.id);
      db.close();
      db = databaseModule.openDatabase(path);
      expect(new ContactService(db).list(user.id)).toEqual([]);
    } finally {
      if (db.open) db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("contact API routes with real Better Auth sessions", () => {
  it("rejects anonymous GET, POST, PATCH and DELETE requests", async () => {
    const responses = [
      await GET(contactRequest("GET")),
      await POST(contactRequest("POST", { input: contactInput })),
      await PATCH(
        contactRequest("PATCH", { input: contactInput, id: "missing" }),
        context("missing"),
      ),
      await DELETE(
        contactRequest("DELETE", { id: "missing" }),
        context("missing"),
      ),
    ];
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({
        error: { code: "UNAUTHENTICATED" },
      });
    }
  });

  it("performs authenticated CRUD using safe non-cacheable envelopes", async () => {
    const user = await signUp(fixture);
    const created = await POST(
      contactRequest("POST", { cookie: user.cookie, input: contactInput }),
    );
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const { data: contact } = await created.json();
    expect(contact).toMatchObject({
      user_id: user.id,
      name: "Asha Rao",
      phone_number: "+919876543210",
      alert_enabled: false,
    });
    const list = await GET(contactRequest("GET", { cookie: user.cookie }));
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ data: [contact] });
    const updated = await PATCH(
      contactRequest("PATCH", {
        cookie: user.cookie,
        input: { ...contactInput, alert_enabled: true },
        id: contact.id,
      }),
      context(contact.id),
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      data: { id: contact.id, alert_enabled: true },
    });
    const deleted = await DELETE(
      contactRequest("DELETE", { cookie: user.cookie, id: contact.id }),
      context(contact.id),
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ data: { deleted: true } });
    expect(
      await (await GET(contactRequest("GET", { cookie: user.cookie }))).json(),
    ).toEqual({ data: [] });
  });

  it("does not reveal, update or delete another user's contacts", async () => {
    const alice = await signUp(fixture);
    const bob = await signUp(fixture);
    const contact = new ContactService(fixture.db).create(
      alice.id,
      contactInput,
    );
    expect(
      await (await GET(contactRequest("GET", { cookie: bob.cookie }))).json(),
    ).toEqual({ data: [] });
    for (const response of [
      await PATCH(
        contactRequest("PATCH", {
          cookie: bob.cookie,
          input: { ...contactInput, name: "Stolen" },
          id: contact.id,
        }),
        context(contact.id),
      ),
      await DELETE(
        contactRequest("DELETE", { cookie: bob.cookie, id: contact.id }),
        context(contact.id),
      ),
    ]) {
      expect(response.status).toBe(404);
      const payload = await response.json();
      expect(payload).toEqual({
        error: { code: "NOT_FOUND", message: "Contact not found." },
      });
      expect(JSON.stringify(payload)).not.toContain(contact.phone_number);
    }
    expect(new ContactService(fixture.db).get(alice.id, contact.id)).toEqual(
      contact,
    );
  });

  it("rejects owner injection in input and ignores owner hints in query/headers", async () => {
    const alice = await signUp(fixture);
    const bob = await signUp(fixture);
    new ContactService(fixture.db).create(alice.id, contactInput);
    const forged = new Request(
      `${TEST_ORIGIN}/api/contacts?user_id=${alice.id}`,
      { headers: { cookie: bob.cookie, "x-user-id": alice.id } },
    );
    expect(await (await GET(forged)).json()).toEqual({ data: [] });
    const response = await POST(
      contactRequest("POST", {
        cookie: bob.cookie,
        input: { ...contactInput, user_id: alice.id },
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    expect(new ContactService(fixture.db).list(bob.id)).toEqual([]);
  });

  it("returns 409 for a normalized duplicate on create and update", async () => {
    const user = await signUp(fixture);
    const service = new ContactService(fixture.db);
    service.create(user.id, contactInput);
    const second = service.create(user.id, {
      ...contactInput,
      phone_number: "+919876543211",
    });
    for (const response of [
      await POST(
        contactRequest("POST", {
          cookie: user.cookie,
          input: { ...contactInput, phone_number: "+91 98765 43210" },
        }),
      ),
      await PATCH(
        contactRequest("PATCH", {
          cookie: user.cookie,
          input: contactInput,
          id: second.id,
        }),
        context(second.id),
      ),
    ]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: "DUPLICATE_CONTACT" },
      });
    }
    expect(service.list(user.id)).toHaveLength(2);
  });

  it.each([
    ["blank name", { name: " " }],
    ["overlong name", { name: "a".repeat(81) }],
    ["invalid number", { phone_number: "123" }],
  ])(
    "returns 400 for %s on both create and update",
    async (_label, invalid) => {
      const user = await signUp(fixture);
      const service = new ContactService(fixture.db);
      const contact = service.create(user.id, contactInput);
      for (const response of [
        await POST(
          contactRequest("POST", {
            cookie: user.cookie,
            input: { ...contactInput, ...invalid },
          }),
        ),
        await PATCH(
          contactRequest("PATCH", {
            cookie: user.cookie,
            input: { ...contactInput, ...invalid },
            id: contact.id,
          }),
          context(contact.id),
        ),
      ]) {
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          error: { code: "INVALID_INPUT" },
        });
      }
      expect(service.list(user.id)).toEqual([contact]);
    },
  );

  it.each([null, "https://attacker.example.test"])(
    "rejects all mutations with origin %s despite a valid session",
    async (origin) => {
      const user = await signUp(fixture);
      const service = new ContactService(fixture.db);
      const contact = service.create(user.id, contactInput);
      for (const response of [
        await POST(
          contactRequest("POST", {
            cookie: user.cookie,
            input: contactInput,
            origin,
          }),
        ),
        await PATCH(
          contactRequest("PATCH", {
            cookie: user.cookie,
            input: contactInput,
            origin,
            id: contact.id,
          }),
          context(contact.id),
        ),
        await DELETE(
          contactRequest("DELETE", {
            cookie: user.cookie,
            origin,
            id: contact.id,
          }),
          context(contact.id),
        ),
      ]) {
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          error: { code: "ORIGIN" },
        });
      }
      expect(service.list(user.id)).toEqual([contact]);
    },
  );

  it("returns 429 after the write quota without mutating the contact", async () => {
    const user = await signUp(fixture);
    // Pin only the contact service clock, not Better Auth session time.
    const now = Date.now();
    const service = new ContactService(fixture.db, () => now);
    const contact = service.create(user.id, contactInput);
    for (let count = 1; count < 60; count++)
      service.update(user.id, contact.id, contactInput);
    const response = await DELETE(
      contactRequest("DELETE", { cookie: user.cookie, id: contact.id }),
      context(contact.id),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      error: { code: "RATE_LIMIT" },
    });
    expect(service.get(user.id, contact.id)).toBeDefined();
  });

  it("handles missing IDs without leaking SQL details", async () => {
    const user = await signUp(fixture);
    const id = "missing-id";
    const response = await DELETE(
      contactRequest("DELETE", { cookie: user.cookie, id }),
      context(id),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Contact not found." },
    });
  });
});
