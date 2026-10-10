import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMigrations } from "better-auth/db/migration";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import * as authModule from "../src/server/auth";
import * as databaseModule from "../src/server/database";
import * as notifications from "../src/server/notifications";
import { ContactService } from "../src/server/contacts";
import { EmergencyService } from "../src/server/emergency";
import { applyRetention } from "../src/server/retention";
import { POST as processJobs } from "../src/app/api/internal/jobs/route";
import {
  GET as listAlerts,
  POST as createAlert,
} from "../src/app/api/sos/route";
import { GET as getAlert } from "../src/app/api/sos/[id]/route";
import { POST as dispatchAlert } from "../src/app/api/sos/[id]/dispatch/route";
import {
  createAuthFixture,
  signUp,
  TEST_ORIGIN,
  type AuthFixture,
} from "./helpers";
import type {
  DeliveryResult,
  NotificationProvider,
} from "../src/server/notifications";

const NOW = 1_800_000_000_000;
const createInput = () => ({ idempotency_key: randomUUID(), consent: true });
const location = (captured_at = NOW) => ({
  latitude: 28.6139,
  longitude: 77.209,
  accuracy: 18,
  captured_at,
});
const providerInput = {
  to: "+919876543210",
  message: "Synthetic test message",
  idempotencyKey: "test-delivery",
};

function fakeProvider(
  result: DeliveryResult = { status: "simulated", code: "LOCAL_SIMULATION" },
) {
  return {
    send: vi.fn<NotificationProvider["send"]>().mockResolvedValue(result),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("notification adapter safety", () => {
  it("uses simulation only outside production and never represents it as delivery", async () => {
    const provider = notifications.selectProvider({
      NODE_ENV: "development",
      NOTIFICATION_PROVIDER: "simulation",
    });
    await expect(
      notifications.sendBounded(provider, providerInput),
    ).resolves.toEqual({
      status: "simulated",
      code: "LOCAL_SIMULATION",
      retryable: false,
    });
  });

  it.each([
    { NODE_ENV: "production", NOTIFICATION_PROVIDER: "simulation" },
    { NODE_ENV: "production", NOTIFICATION_PROVIDER: "disabled" },
    { NODE_ENV: "development", NOTIFICATION_PROVIDER: "unconfigured" },
    { NODE_ENV: "development" },
  ] as const)("fails closed for provider environment %j", async (env) => {
    await expect(
      notifications.sendBounded(
        notifications.selectProvider(env),
        providerInput,
      ),
    ).resolves.toEqual({
      status: "failed",
      code: "PROVIDER_NOT_CONFIGURED",
      retryable: false,
    });
  });

  it.each(["accepted", "delivered", "failed", "unknown", "simulated"] as const)(
    "preserves the provider's %s status without inventing delivery",
    async (status) => {
      const provider = fakeProvider({ status });
      await expect(
        notifications.sendBounded(provider, providerInput),
      ).resolves.toEqual({ status });
      expect(provider.send).toHaveBeenCalledWith({
        ...providerInput,
        signal: expect.any(AbortSignal),
      });
    },
  );

  it("bounds hung sends, aborts the provider signal, and never retries an ambiguous timeout", async () => {
    let signal: AbortSignal | undefined;
    const provider = {
      send: vi
        .fn<NotificationProvider["send"]>()
        .mockImplementation((input) => {
          signal = input.signal;
          return new Promise<DeliveryResult>(() => {});
        }),
    };
    await expect(
      notifications.sendBounded(provider, providerInput, 10),
    ).resolves.toEqual({
      status: "unknown",
      code: "PROVIDER_TIMEOUT",
      retryable: false,
    });
    expect(signal?.aborted).toBe(true);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it("treats rejected sends as unknown without exposing exception details", async () => {
    const provider = fakeProvider();
    provider.send.mockRejectedValue(
      new Error("secret provider credential and recipient"),
    );
    await expect(
      notifications.sendBounded(provider, providerInput),
    ).resolves.toEqual({
      status: "unknown",
      code: "PROVIDER_UNCERTAIN",
      retryable: false,
    });
  });

  it.each([
    { status: "sent" },
    { status: "delivered", code: "PII: +919876543210" },
    { status: "accepted", providerId: "a".repeat(201) },
    null,
  ])("treats invalid provider data as unknown: %j", async (result) => {
    const provider = fakeProvider();
    provider.send.mockResolvedValue(result as unknown as DeliveryResult);
    await expect(
      notifications.sendBounded(provider, providerInput),
    ).resolves.toEqual({
      status: "unknown",
      code: "INVALID_PROVIDER_RESPONSE",
      retryable: false,
    });
  });
});

describe("SOS service and routes with real auth and SQLite", () => {
  let fixture: AuthFixture;
  let now: number;
  let provider: ReturnType<typeof fakeProvider>;
  let service: EmergencyService;

  beforeEach(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(48).toString("base64url"));
    vi.stubEnv("BETTER_AUTH_URL", TEST_ORIGIN);
    vi.stubEnv("DATABASE_PATH", ":memory:");
    fixture = await createAuthFixture();
    now = NOW;
    provider = fakeProvider();
    service = new EmergencyService(fixture.db, provider, () => now);
    // Only factories and the external notification boundary are redirected.
    // Auth handlers, session cookies, routes, transactions and SQL remain real.
    vi.spyOn(authModule, "getAuth").mockReturnValue(fixture.auth);
    vi.spyOn(databaseModule, "getDatabase").mockReturnValue(fixture.db);
    vi.spyOn(notifications, "selectProvider").mockReturnValue(provider);
  });

  afterEach(() => fixture?.close());

  function contact(user: string, enabled = true, phone = "9876543210") {
    return new ContactService(fixture.db, () => now).create(user, {
      name: "Synthetic SOS Contact",
      phone_number: phone,
      alert_enabled: enabled,
    });
  }

  function request(
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
      `${TEST_ORIGIN}/api/sos${options.id ? `/${options.id}` : ""}`,
      {
        method,
        headers,
        body:
          options.input === undefined
            ? undefined
            : JSON.stringify(options.input),
      },
    );
  }

  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  it("persists the alert and selected outbox recipients before location acquisition or send", async () => {
    const user = await signUp(fixture);
    const enabled = contact(user.id);
    contact(user.id, false, "9876543211");
    const alert = service.create(user.id, createInput());
    expect(alert).toMatchObject({
      user_id: user.id,
      status: "created",
      latitude: null,
      longitude: null,
      location_captured_at: null,
      created_at: now,
    });
    expect(alert.deliveries).toEqual([
      expect.objectContaining({
        contact_id: enabled.id,
        status: "queued",
        attempt_count: 0,
      }),
    ]);
    expect(service.get(user.id, alert.id)).toEqual(alert);
    expect(
      fixture.db.prepare("SELECT id FROM delivery_attempts").all(),
    ).toEqual([]);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("requires explicit consent and a valid idempotency key", async () => {
    const user = await signUp(fixture);
    for (const input of [
      { idempotency_key: randomUUID(), consent: false },
      { idempotency_key: randomUUID() },
      { idempotency_key: "not-a-uuid", consent: true },
      { ...createInput(), user_id: "other-owner" },
    ]) {
      expect(() => service.create(user.id, input)).toThrow(ZodError);
    }
    expect(service.list(user.id)).toEqual([]);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("records a failed alert without sending when no sharing-enabled contacts exist", async () => {
    const user = await signUp(fixture);
    contact(user.id, false);
    const alert = service.create(user.id, createInput());
    expect(alert).toMatchObject({
      status: "failed",
      reason: "NO_CONTACTS",
      deliveries: [],
    });
    expect(
      await service.dispatch(user.id, alert.id, { location: null }),
    ).toMatchObject({ status: "failed", reason: "NO_CONTACTS" });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent create requests and scopes idempotency to the owner", async () => {
    const alice = await signUp(fixture);
    const bob = await signUp(fixture);
    contact(alice.id);
    contact(bob.id);
    const input = createInput();
    const alerts = await Promise.all(
      Array.from({ length: 6 }, async () => service.create(alice.id, input)),
    );
    expect(new Set(alerts.map((alert) => alert.id)).size).toBe(1);
    expect(service.list(alice.id)).toHaveLength(1);
    expect(service.create(bob.id, input).id).not.toBe(alerts[0].id);
    expect(
      fixture.db
        .prepare("SELECT id FROM deliveries WHERE alert_id = ?")
        .all(alerts[0].id),
    ).toHaveLength(1);
    expect(
      fixture.db
        .prepare(
          "SELECT id FROM audit_events WHERE action = 'sos.created' AND user_id = ?",
        )
        .all(alice.id),
    ).toHaveLength(1);
  });

  it("throttles new alerts but still returns an existing idempotent alert", async () => {
    const user = await signUp(fixture);
    const input = createInput();
    const first = service.create(user.id, input);
    for (let count = 1; count < 10; count++)
      service.create(user.id, createInput());
    expect(() => service.create(user.id, createInput())).toThrow(
      expect.objectContaining({ status: 429, code: "RATE_LIMIT" }),
    );
    expect(service.create(user.id, input).id).toBe(first.id);
    now += 60_000;
    expect(service.create(user.id, createInput()).id).not.toBe(first.id);
  });

  it("persists valid location and emits a timestamped map link only to enabled owned contacts", async () => {
    const alice = await signUp(fixture);
    const bob = await signUp(fixture);
    contact(alice.id);
    contact(alice.id, false, "9876543211");
    contact(bob.id, true, "9876543212");
    const alert = service.create(alice.id, createInput());
    provider.send.mockImplementation(async (input) => {
      expect(service.get(alice.id, alert.id)).toMatchObject({
        latitude: 28.6139,
        longitude: 77.209,
        location_accuracy_meters: 18,
        location_captured_at: now,
      });
      expect(
        fixture.db
          .prepare("SELECT status,attempt_number FROM delivery_attempts")
          .all(),
      ).toEqual([{ status: "sending", attempt_number: 1 }]);
      expect(input.to).toBe("+919876543210");
      return { status: "accepted", providerId: "test-provider-reference" };
    });
    const result = await service.dispatch(alice.id, alert.id, {
      location: location(now),
    });
    expect(result.status).toBe("accepted");
    expect(provider.send).toHaveBeenCalledTimes(1);
    const message = provider.send.mock.calls[0][0].message;
    expect(message).toContain("https://maps.google.com/?q=28.6139,77.209");
    expect(message).toContain(new Date(now).toISOString());
    expect(message).toContain("accuracy 18m");
    expect(message).toContain("does not alert emergency services");
    expect(
      JSON.stringify(fixture.db.prepare("SELECT * FROM audit_events").all()),
    ).not.toContain("28.6139");
  });

  it("sends without location when none is available and never invents coordinates", async () => {
    const user = await signUp(fixture);
    contact(user.id);
    const alert = service.create(user.id, createInput());
    const result = await service.dispatch(user.id, alert.id, {
      location: null,
    });
    expect(result).toMatchObject({
      status: "simulated",
      latitude: null,
      longitude: null,
      location_captured_at: null,
    });
    expect(provider.send.mock.calls[0][0].message).toContain(
      "Location unavailable.",
    );
    expect(provider.send.mock.calls[0][0].message).not.toContain(
      "maps.google.com",
    );
  });

  it.each([
    ["latitude", { latitude: 90.01 }],
    ["longitude", { longitude: -180.01 }],
    ["negative accuracy", { accuracy: -1 }],
    ["excessive accuracy", { accuracy: 100001 }],
    ["nonfinite coordinate", { latitude: Number.NaN }],
    ["infinite coordinate", { longitude: Number.POSITIVE_INFINITY }],
    ["fractional capture time", { captured_at: NOW + 0.5 }],
    ["missing capture time", { captured_at: undefined }],
    ["untrusted extra field", { user_id: "other-user" }],
  ])("rejects invalid %s without starting a send", async (_label, invalid) => {
    const user = await signUp(fixture);
    contact(user.id);
    const alert = service.create(user.id, createInput());
    await expect(
      service.dispatch(user.id, alert.id, {
        location: { ...location(now), ...invalid },
      }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(service.get(user.id, alert.id)).toMatchObject({
      status: "created",
      latitude: null,
    });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it.each([NOW - 300001, NOW + 30001])(
    "rejects stale/future capture time %s then permits no-location fallback",
    async (captured_at) => {
      const user = await signUp(fixture);
      contact(user.id);
      const alert = service.create(user.id, createInput());
      await expect(
        service.dispatch(user.id, alert.id, {
          location: location(captured_at),
        }),
      ).rejects.toMatchObject({ status: 400, code: "LOCATION_TIME" });
      expect(provider.send).not.toHaveBeenCalled();
      expect(
        (await service.dispatch(user.id, alert.id, { location: null })).status,
      ).toBe("simulated");
    },
  );

  it.each([NOW - 300000, NOW + 30000])(
    "accepts capture time at freshness boundary %s and coordinate limits",
    async (captured_at) => {
      const user = await signUp(fixture);
      contact(user.id);
      const alert = service.create(user.id, createInput());
      expect(
        await service.dispatch(user.id, alert.id, {
          location: { latitude: -90, longitude: 180, accuracy: 0, captured_at },
        }),
      ).toMatchObject({ status: "simulated", latitude: -90, longitude: 180 });
    },
  );

  it("claims concurrent dispatch exactly once and preserves the first persisted location", async () => {
    const user = await signUp(fixture);
    contact(user.id);
    const alert = service.create(user.id, createInput());
    const result = deferred<DeliveryResult>();
    const entered = deferred<void>();
    provider.send.mockImplementation(() => {
      entered.resolve();
      return result.promise;
    });
    const first = service.dispatch(user.id, alert.id, {
      location: location(now),
    });
    await entered.promise;
    const second = await service.dispatch(user.id, alert.id, {
      location: null,
    });
    expect(second.latitude).toBe(28.6139);
    expect(provider.send).toHaveBeenCalledTimes(1);
    result.resolve({ status: "delivered" });
    expect((await first).status).toBe("delivered");
    expect(
      (await service.dispatch(user.id, alert.id, { location: null })).status,
    ).toBe("delivered");
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(
      fixture.db.prepare("SELECT attempt_number FROM delivery_attempts").all(),
    ).toEqual([{ attempt_number: 1 }]);
  });

  it.each(["accepted", "delivered", "simulated", "unknown"] as const)(
    "never automatically retries %s deliveries",
    async (status) => {
      const user = await signUp(fixture);
      contact(user.id);
      provider.send.mockResolvedValue({ status, retryable: true });
      const alert = service.create(user.id, createInput());
      expect(
        (await service.dispatch(user.id, alert.id, { location: null })).status,
      ).toBe(status);
      now += 120_000;
      await service.processPending();
      await service.dispatch(user.id, alert.id, { location: null });
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(service.get(user.id, alert.id).deliveries[0].attempt_count).toBe(
        1,
      );
    },
  );

  it("retries only safe failures at 60-second intervals up to three total attempts", async () => {
    const user = await signUp(fixture);
    contact(user.id);
    provider.send.mockResolvedValue({
      status: "failed",
      code: "TEMPORARY_FAILURE",
      retryable: true,
    });
    const alert = service.create(user.id, createInput());
    await service.dispatch(user.id, alert.id, { location: null });
    now += 59_999;
    await service.processPending();
    expect(provider.send).toHaveBeenCalledTimes(1);
    now++;
    await service.processPending();
    expect(provider.send).toHaveBeenCalledTimes(2);
    now += 60_000;
    await service.processPending();
    expect(provider.send).toHaveBeenCalledTimes(3);
    now += 60_000;
    await service.processPending();
    expect(provider.send).toHaveBeenCalledTimes(3);
    expect(service.get(user.id, alert.id)).toMatchObject({
      status: "failed",
      deliveries: [expect.objectContaining({ attempt_count: 3 })],
    });
    expect(
      new Set(provider.send.mock.calls.map(([input]) => input.idempotencyKey))
        .size,
    ).toBe(1);
    expect(
      fixture.db
        .prepare(
          "SELECT attempt_number FROM delivery_attempts ORDER BY attempt_number",
        )
        .all(),
    ).toEqual([
      { attempt_number: 1 },
      { attempt_number: 2 },
      { attempt_number: 3 },
    ]);
  });

  it("stops safe retries after recovery succeeds or a nonretryable failure occurs", async () => {
    const user = await signUp(fixture);
    contact(user.id);
    provider.send
      .mockResolvedValueOnce({ status: "failed", retryable: true })
      .mockResolvedValueOnce({ status: "accepted" });
    const alert = service.create(user.id, createInput());
    await service.dispatch(user.id, alert.id, { location: null });
    now += 60_000;
    await service.processPending();
    expect(service.get(user.id, alert.id).status).toBe("accepted");
    now += 60_000;
    await service.processPending();
    expect(provider.send).toHaveBeenCalledTimes(2);
    provider.send.mockResolvedValue({
      status: "failed",
      code: "PROVIDER_NOT_CONFIGURED",
      retryable: false,
    });
    const failed = service.create(user.id, createInput());
    await service.dispatch(user.id, failed.id, { location: null });
    now += 60_000;
    await service.processPending();
    expect(provider.send).toHaveBeenCalledTimes(3);
  });

  it("turns a hung provider into unknown and does not resend it", async () => {
    const user = await signUp(fixture);
    contact(user.id);
    provider.send.mockImplementation(
      () => new Promise<DeliveryResult>(() => {}),
    );
    const alert = service.create(user.id, createInput());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = service.dispatch(user.id, alert.id, { location: null });
    await vi.advanceTimersByTimeAsync(5_001);
    const result = await pending;
    expect(result).toMatchObject({
      status: "unknown",
      deliveries: [
        expect.objectContaining({
          status: "unknown",
          code: "PROVIDER_TIMEOUT",
          attempt_count: 1,
        }),
      ],
    });
    expect(provider.send.mock.calls[0][0].signal.aborted).toBe(true);
    now += 120_000;
    await service.processPending();
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it("recovers abandoned created alerts without location only after 15 seconds", async () => {
    const user = await signUp(fixture);
    contact(user.id);
    const alert = service.create(user.id, createInput());
    now += 14_999;
    await service.processPending();
    expect(service.get(user.id, alert.id).status).toBe("created");
    expect(provider.send).not.toHaveBeenCalled();
    now++;
    await service.processPending();
    expect(service.get(user.id, alert.id)).toMatchObject({
      status: "simulated",
      latitude: null,
      longitude: null,
    });
    expect(provider.send.mock.calls[0][0].message).toContain(
      "Location unavailable.",
    );
  });

  it("marks expired sending leases unknown and ignores late provider success", async () => {
    const user = await signUp(fixture);
    contact(user.id);
    const alert = service.create(user.id, createInput());
    const result = deferred<DeliveryResult>();
    const entered = deferred<void>();
    provider.send.mockImplementation(() => {
      entered.resolve();
      return result.promise;
    });
    const pending = service.dispatch(user.id, alert.id, { location: null });
    await entered.promise;
    now += 30_000;
    await service.processPending();
    expect(service.get(user.id, alert.id)).toMatchObject({
      status: "unknown",
      deliveries: [expect.objectContaining({ code: "WORKER_INTERRUPTED" })],
    });
    result.resolve({ status: "delivered" });
    await pending;
    expect(service.get(user.id, alert.id).status).toBe("unknown");
    expect(
      fixture.db.prepare("SELECT status,code FROM delivery_attempts").all(),
    ).toEqual([{ status: "unknown", code: "WORKER_INTERRUPTED" }]);
    now += 120_000;
    await service.processPending();
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(
      fixture.db
        .prepare(
          "SELECT id FROM audit_events WHERE action = 'notification.delivered'",
        )
        .all(),
    ).toEqual([]);
  });

  it.each(["queued", "sending"])(
    "reconciles a stale %s parent from durable recipient results without resending",
    async (status) => {
      const user = await signUp(fixture);
      contact(user.id);
      provider.send.mockResolvedValue({ status: "delivered" });
      const alert = service.create(user.id, createInput());
      await service.dispatch(user.id, alert.id, { location: null });
      // Model a crash after recipient result commit but before parent aggregation.
      fixture.db
        .prepare("UPDATE alerts SET status = ? WHERE id = ?")
        .run(status, alert.id);
      await service.processPending();
      expect(service.get(user.id, alert.id).status).toBe("delivered");
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(
        fixture.db
          .prepare("SELECT status,attempt_number FROM delivery_attempts")
          .all(),
      ).toEqual([{ status: "delivered", attempt_number: 1 }]);
    },
  );

  it.each(["disable", "delete"] as const)(
    "does not send when a selected contact is later %sd",
    async (action) => {
      const user = await signUp(fixture);
      const selected = contact(user.id);
      const alert = service.create(user.id, createInput());
      const contacts = new ContactService(fixture.db, () => now);
      if (action === "delete") contacts.delete(user.id, selected.id);
      else
        contacts.update(user.id, selected.id, {
          name: selected.name,
          phone_number: selected.phone_number,
          alert_enabled: false,
        });
      expect(
        await service.dispatch(user.id, alert.id, { location: null }),
      ).toMatchObject({
        status: "failed",
        deliveries: [expect.objectContaining({ code: "CONTACT_UNAVAILABLE" })],
      });
      expect(provider.send).not.toHaveBeenCalled();
    },
  );

  it("reports mixed recipient outcomes as partial, not universally delivered", async () => {
    const user = await signUp(fixture);
    contact(user.id);
    contact(user.id, true, "9876543211");
    provider.send
      .mockResolvedValueOnce({ status: "delivered" })
      .mockResolvedValueOnce({ status: "failed", retryable: false });
    const alert = service.create(user.id, createInput());
    const result = await service.dispatch(user.id, alert.id, {
      location: null,
    });
    expect(result.status).toBe("partial");
    expect(result.deliveries.map((delivery) => delivery.status).sort()).toEqual(
      ["delivered", "failed"],
    );
  });

  it("persists pending alerts across database close and resumes after restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sakhi-sos-test-"));
    const path = join(directory, "sos.sqlite");
    let db = databaseModule.openDatabase(path);
    try {
      const auth = authModule.createAuth(db);
      await (await getMigrations(auth.options)).runMigrations();
      databaseModule.migrate(db);
      const user = await signUp({ auth, db, close: () => db.close() });
      new ContactService(db, () => now).create(user.id, {
        name: "Persistent Contact",
        phone_number: "9876543210",
        alert_enabled: true,
      });
      const input = createInput();
      const before = new EmergencyService(db, provider, () => now).create(
        user.id,
        input,
      );
      db.close();
      db = databaseModule.openDatabase(path);
      const restarted = new EmergencyService(db, provider, () => now);
      expect(restarted.create(user.id, input)).toEqual(before);
      now += 15_000;
      await restarted.processPending();
      db.close();
      db = databaseModule.openDatabase(path);
      expect(
        new EmergencyService(db, provider, () => now).get(user.id, before.id),
      ).toMatchObject({
        status: "simulated",
        deliveries: [expect.objectContaining({ attempt_count: 1 })],
      });
      expect(provider.send).toHaveBeenCalledTimes(1);
    } finally {
      if (db.open) db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("denies another owner list/detail/dispatch access without side effects", async () => {
    const alice = await signUp(fixture);
    const bob = await signUp(fixture);
    contact(alice.id);
    const alert = service.create(alice.id, createInput());
    expect(service.list(bob.id)).toEqual([]);
    expect(() => service.get(bob.id, alert.id)).toThrow(
      expect.objectContaining({ status: 404, code: "NOT_FOUND" }),
    );
    await expect(
      service.dispatch(bob.id, alert.id, { location: null }),
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(service.get(alice.id, alert.id)).toEqual(alert);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("rejects anonymous SOS list/create/detail/dispatch API requests", async () => {
    const id = randomUUID();
    const responses = [
      await listAlerts(request("GET")),
      await createAlert(request("POST", { input: createInput() })),
      await getAlert(request("GET", { id }), context(id)),
      await dispatchAlert(
        request("POST", { input: { location: null }, id }),
        context(id),
      ),
    ];
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "UNAUTHENTICATED" },
      });
    }
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("protects the recovery job with its own secret rather than a user session", async () => {
    const user = await signUp(fixture);
    contact(user.id);
    const alert = service.create(user.id, createInput());
    const jobSecret = randomBytes(48).toString("base64url");
    vi.stubEnv("JOB_SECRET", "");
    let response = await processJobs(
      new Request(`${TEST_ORIGIN}/api/internal/jobs`, { method: "POST" }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "JOB_NOT_CONFIGURED" },
    });
    vi.stubEnv("JOB_SECRET", jobSecret);
    const rejectedHeaders: Record<string, string>[] = [
      { cookie: user.cookie },
      { authorization: "Bearer wrong-secret" },
      { authorization: `Basic ${jobSecret}` },
    ];
    for (const headers of rejectedHeaders) {
      response = await processJobs(
        new Request(`${TEST_ORIGIN}/api/internal/jobs`, {
          method: "POST",
          headers,
        }),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "UNAUTHENTICATED" },
      });
    }
    expect(service.get(user.id, alert.id).status).toBe("created");
    expect(provider.send).not.toHaveBeenCalled();
    // The job's real clock sees this persisted record as abandoned.
    fixture.db
      .prepare("UPDATE alerts SET created_at = ? WHERE id = ?")
      .run(Date.now() - 16_000, alert.id);
    fixture.db
      .prepare("UPDATE deliveries SET next_attempt_at = ? WHERE alert_id = ?")
      .run(Date.now() - 16_000, alert.id);
    response = await processJobs(
      new Request(`${TEST_ORIGIN}/api/internal/jobs`, {
        method: "POST",
        headers: { authorization: `Bearer ${jobSecret}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { processed: 1, retention: { locations: 0, alerts: 0, audits: 0 } },
    });
    expect(service.get(user.id, alert.id).status).toBe("simulated");
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it("clears precise locations after 24 hours while retaining alert history", async () => {
    const user = await signUp(fixture);
    contact(user.id);
    const alert = service.create(user.id, createInput());
    await service.dispatch(user.id, alert.id, { location: location(now) });
    expect(applyRetention(fixture.db, now + 86_400_000).locations).toBe(0);
    expect(applyRetention(fixture.db, now + 86_400_001)).toMatchObject({
      locations: 1,
      alerts: 0,
    });
    expect(service.get(user.id, alert.id)).toMatchObject({
      status: "simulated",
      latitude: null,
      longitude: null,
      location_accuracy_meters: null,
      location_captured_at: null,
    });
    expect(service.get(user.id, alert.id).deliveries).toHaveLength(1);
  });

  it("expires terminal alerts after 30 days and audits after 90 days, not pending alerts", async () => {
    const user = await signUp(fixture);
    contact(user.id);
    const terminal = service.create(user.id, createInput());
    await service.dispatch(user.id, terminal.id, { location: null });
    const pending = service.create(user.id, createInput());
    expect(applyRetention(fixture.db, now + 30 * 86_400_000).alerts).toBe(0);
    const expired = applyRetention(fixture.db, now + 30 * 86_400_000 + 1);
    expect(expired.alerts).toBe(1);
    expect(expired.audits).toBe(0);
    expect(() => service.get(user.id, terminal.id)).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    expect(service.get(user.id, pending.id).status).toBe("created");
    expect(
      fixture.db
        .prepare("SELECT id FROM deliveries WHERE alert_id = ?")
        .all(terminal.id),
    ).toEqual([]);
    expect(
      fixture.db.prepare("SELECT id FROM delivery_attempts").all(),
    ).toEqual([]);
    expect(
      fixture.db.prepare("SELECT id FROM audit_events").all().length,
    ).toBeGreaterThan(0);
    const oldAudits = fixture.db
      .prepare("SELECT id FROM audit_events")
      .all().length;
    expect(applyRetention(fixture.db, now + 90 * 86_400_000 + 1).audits).toBe(
      oldAudits,
    );
    expect(fixture.db.prepare("SELECT id FROM audit_events").all()).toEqual([]);
  });

  it("creates, deduplicates, dispatches and retrieves through real-session API routes", async () => {
    const user = await signUp(fixture);
    contact(user.id);
    const input = createInput();
    const created = await createAlert(
      request("POST", { cookie: user.cookie, input }),
    );
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const { data: alert } = await created.json();
    expect(alert).toMatchObject({ status: "created", user_id: user.id });
    const duplicate = await createAlert(
      request("POST", { cookie: user.cookie, input }),
    );
    expect((await duplicate.json()).data.id).toBe(alert.id);
    const dispatched = await dispatchAlert(
      request("POST", {
        cookie: user.cookie,
        input: { location: null },
        id: alert.id,
      }),
      context(alert.id),
    );
    expect(dispatched.status).toBe(200);
    expect(await dispatched.json()).toMatchObject({
      data: { id: alert.id, status: "simulated" },
    });
    const detail = await getAlert(
      request("GET", { cookie: user.cookie, id: alert.id }),
      context(alert.id),
    );
    expect(detail.headers.get("cache-control")).toBe("no-store");
    expect(await detail.json()).toMatchObject({
      data: { id: alert.id, status: "simulated" },
    });
    const list = await listAlerts(request("GET", { cookie: user.cookie }));
    expect((await list.json()).data).toHaveLength(1);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it("returns safe 404s for foreign alerts through detail/dispatch routes", async () => {
    const alice = await signUp(fixture);
    const bob = await signUp(fixture);
    contact(alice.id);
    const alert = service.create(alice.id, createInput());
    for (const response of [
      await getAlert(
        request("GET", { cookie: bob.cookie, id: alert.id }),
        context(alert.id),
      ),
      await dispatchAlert(
        request("POST", {
          cookie: bob.cookie,
          id: alert.id,
          input: { location: null },
        }),
        context(alert.id),
      ),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Alert not found." },
      });
    }
    expect(
      await (await listAlerts(request("GET", { cookie: bob.cookie }))).json(),
    ).toEqual({ data: [] });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it.each([null, "https://attacker.example.test"])(
    "rejects create and dispatch with invalid origin %s",
    async (origin) => {
      const user = await signUp(fixture);
      contact(user.id);
      const alert = service.create(user.id, createInput());
      for (const response of [
        await createAlert(
          request("POST", {
            cookie: user.cookie,
            origin,
            input: createInput(),
          }),
        ),
        await dispatchAlert(
          request("POST", {
            cookie: user.cookie,
            origin,
            id: alert.id,
            input: { location: null },
          }),
          context(alert.id),
        ),
      ]) {
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          error: { code: "ORIGIN" },
        });
      }
      expect(provider.send).not.toHaveBeenCalled();
    },
  );

  it("returns validation errors for missing consent, forged ownership, and invalid location", async () => {
    const user = await signUp(fixture);
    contact(user.id);
    for (const input of [
      { ...createInput(), consent: false },
      { ...createInput(), user_id: "another-user" },
    ]) {
      const response = await createAlert(
        request("POST", { cookie: user.cookie, input }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "INVALID_INPUT" },
      });
    }
    const alert = service.create(user.id, createInput());
    const response = await dispatchAlert(
      request("POST", {
        cookie: user.cookie,
        id: alert.id,
        input: { location: { ...location(Date.now()), longitude: 181 } },
      }),
      context(alert.id),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    expect(provider.send).not.toHaveBeenCalled();
  });
});
