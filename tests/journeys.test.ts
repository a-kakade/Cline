import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import * as authModule from "../src/server/auth";
import * as databaseModule from "../src/server/database";
import * as notifications from "../src/server/notifications";
import { ContactService } from "../src/server/contacts";
import { EmergencyService } from "../src/server/emergency";
import { JourneyService } from "../src/server/journeys";
import { AppError } from "../src/server/http";
import { applyRetention } from "../src/server/retention";
import {
  ACTION_ALLOWED,
  JOURNEY_STATUSES,
  dueSystemTransition,
  escalationDeadline,
  isOpen,
} from "../src/lib/journey-state";
import {
  GET as listJourneys,
  POST as createJourney,
} from "../src/app/api/journeys/route";
import { GET as getMonitor } from "../src/app/api/journeys/monitor/route";
import { GET as getJourney } from "../src/app/api/journeys/[id]/route";
import { POST as journeyAction } from "../src/app/api/journeys/[id]/[action]/route";
import { GET as listAlerts } from "../src/app/api/sos/route";
import { POST as processJobs } from "../src/app/api/internal/jobs/route";
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
const MIN = 60_000;

function fakeProvider(
  result: DeliveryResult = { status: "simulated", code: "LOCAL_SIMULATION" },
) {
  return {
    send: vi.fn<NotificationProvider["send"]>().mockResolvedValue(result),
  };
}

describe("journey state machine (pure)", () => {
  it("only allows terminal actions from open states and never from terminal states", () => {
    for (const status of ["completed", "cancelled"] as const) {
      for (const allowed of Object.values(ACTION_ALLOWED))
        expect(allowed).not.toContain(status);
      expect(isOpen(status)).toBe(false);
    }
    expect(ACTION_ALLOWED.complete).toContain("escalated");
    expect(ACTION_ALLOWED["check-in"]).not.toContain("escalated");
    expect(ACTION_ALLOWED.extend).not.toContain("escalated");
    expect(JOURNEY_STATUSES).toHaveLength(5);
  });

  it("derives the next automatic transition only from time and status", () => {
    const base = { expected_arrival_at: NOW, grace_period_minutes: 10 };
    expect(escalationDeadline(base)).toBe(NOW + 10 * MIN);
    expect(
      dueSystemTransition({ ...base, status: "active" }, NOW - 1),
    ).toBeNull();
    expect(dueSystemTransition({ ...base, status: "active" }, NOW)).toBe(
      "check_in_due",
    );
    expect(
      dueSystemTransition(
        { ...base, status: "check_in_due" },
        NOW + 10 * MIN - 1,
      ),
    ).toBeNull();
    expect(
      dueSystemTransition({ ...base, status: "check_in_due" }, NOW + 10 * MIN),
    ).toBe("escalated");
    for (const status of ["escalated", "completed", "cancelled"] as const)
      expect(
        dueSystemTransition({ ...base, status }, NOW + 999 * MIN),
      ).toBeNull();
  });
});

describe("Journey Guardian with real auth and SQLite", () => {
  let fixture: AuthFixture;
  let now: number;
  let provider: ReturnType<typeof fakeProvider>;
  let emergency: EmergencyService;
  let service: JourneyService;

  beforeEach(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(48).toString("base64url"));
    vi.stubEnv("BETTER_AUTH_URL", TEST_ORIGIN);
    vi.stubEnv("DATABASE_PATH", ":memory:");
    fixture = await createAuthFixture();
    now = NOW;
    provider = fakeProvider();
    emergency = new EmergencyService(fixture.db, provider, () => now);
    service = new JourneyService(fixture.db, emergency, () => now);
    vi.spyOn(authModule, "getAuth").mockReturnValue(fixture.auth);
    vi.spyOn(databaseModule, "getDatabase").mockReturnValue(fixture.db);
    vi.spyOn(notifications, "selectProvider").mockReturnValue(provider);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fixture?.close();
  });

  function contact(user: string, enabled = true, phone = "9876543210") {
    return new ContactService(fixture.db, () => now).create(user, {
      name: "Synthetic Contact",
      phone_number: phone,
      alert_enabled: enabled,
    });
  }
  function setSharing(
    user: string,
    c: { id: string; name: string; phone_number: string },
    enabled: boolean,
  ) {
    new ContactService(fixture.db, () => now).update(user, c.id, {
      name: c.name,
      phone_number: c.phone_number,
      alert_enabled: enabled,
    });
  }
  const input = (contactIds: string[], over: Record<string, unknown> = {}) => ({
    idempotency_key: randomUUID(),
    destination: "Home",
    expected_arrival_at: now + 30 * MIN,
    grace_period_minutes: 10,
    contact_ids: contactIds,
    consent: true,
    ...over,
  });
  async function started(over: Record<string, unknown> = {}) {
    const user = await signUp(fixture);
    const c = contact(user.id);
    const journey = service.create(user.id, input([c.id], over));
    return { user, contact: c, journey };
  }
  const rows = (sql: string, ...args: unknown[]) =>
    fixture.db.prepare(sql).all(...args) as Record<string, unknown>[];
  const alertCount = () => rows("SELECT id FROM alerts").length;
  // Accessing the private step lets tests replay a stale scheduler snapshot.
  const privateCheckInDue = (user: string, id: string, at: number) =>
    (
      service as unknown as {
        markCheckInDue: (u: string, i: string, n: number) => boolean;
      }
    ).markCheckInDue(user, id, at);
  const privateEscalate = (user: string, id: string, at: number) =>
    (
      service as unknown as {
        escalate: (u: string, i: string, n: number) => boolean;
      }
    ).escalate(user, id, at);

  describe("creation and persistence", () => {
    it("persists an active journey with its selected contacts and a started event", async () => {
      const {
        user,
        contact: c,
        journey,
      } = await started({
        origin: "  Office  ",
        time_zone: "Asia/Kolkata",
      });
      expect(journey).toMatchObject({
        user_id: user.id,
        status: "active",
        origin: "Office",
        destination: "Home",
        grace_period_minutes: 10,
        time_zone: "Asia/Kolkata",
        contact_ids: [c.id],
        alert: null,
        alert_id: null,
        started_at: NOW,
      });
      expect(journey.events).toEqual([{ kind: "started", created_at: NOW }]);
      // A "browser refresh" is a fresh service instance reading the database.
      const reloaded = new JourneyService(fixture.db, emergency, () => now);
      expect(reloaded.get(user.id, journey.id)).toEqual(journey);
      expect(reloaded.list(user.id)).toEqual([journey]);
    });

    it("is idempotent per request key and allows only one open journey", async () => {
      const { user, contact: c, journey } = await started();
      const key = randomUUID();
      expect(() =>
        service.create(user.id, input([c.id], { idempotency_key: key })),
      ).toThrow(expect.objectContaining({ code: "JOURNEY_OPEN" }));
      // Replaying the original request returns the same journey, not a conflict.
      const first = fixture.db
        .prepare("SELECT idempotency_key FROM journeys WHERE id=?")
        .get(journey.id) as { idempotency_key: string };
      expect(
        service.create(
          user.id,
          input([c.id], { idempotency_key: first.idempotency_key }),
        ).id,
      ).toBe(journey.id);
      expect(rows("SELECT id FROM journeys")).toHaveLength(1);
    });

    it("validates destination, consent, arrival window, contacts and time zone", async () => {
      const user = await signUp(fixture);
      const c = contact(user.id);
      const disabled = contact(user.id, false, "9876543211");
      const other = await signUp(fixture);
      const foreign = contact(other.id, true, "9876543212");
      const bad: [Record<string, unknown>, unknown][] = [
        [{ destination: "   " }, ZodError],
        [{ consent: false }, ZodError],
        [{ contact_ids: [] }, ZodError],
        [{ contact_ids: [c.id, c.id] }, ZodError],
        [{ time_zone: "Not/AZone" }, ZodError],
        [{ grace_period_minutes: 0 }, ZodError],
        [{ grace_period_minutes: 61 }, ZodError],
        [{ extra: true }, ZodError],
        [
          { expected_arrival_at: now + 30_000 },
          expect.objectContaining({ code: "INVALID_ETA" }),
        ],
        [
          { expected_arrival_at: now + 25 * 60 * MIN },
          expect.objectContaining({ code: "INVALID_ETA" }),
        ],
        [
          { contact_ids: [disabled.id] },
          expect.objectContaining({ code: "CONTACT_SELECTION" }),
        ],
        [
          { contact_ids: [foreign.id] },
          expect.objectContaining({ code: "CONTACT_SELECTION" }),
        ],
      ];
      for (const [over, error] of bad)
        expect(() => service.create(user.id, input([c.id], over))).toThrow(
          error as never,
        );
      expect(rows("SELECT id FROM journeys")).toHaveLength(0);
    });

    it("keeps only a fresh optional location and works without one", async () => {
      const loc = (captured_at: number) => ({
        latitude: 28.6139,
        longitude: 77.209,
        accuracy: 20,
        captured_at,
      });
      const a = await started({ location: loc(now - 10_000) });
      expect(a.journey.last_known_latitude).toBe(28.6139);
      expect(a.journey.last_location_updated_at).toBe(now - 10_000);
      service.transition(a.user.id, a.journey.id, "cancel", {});
      const b = await started({ location: loc(now - 10 * MIN) });
      expect(b.journey.last_known_latitude).toBeNull();
      const c = await started({ location: null });
      expect(c.journey.status).toBe("active");
    });
  });

  describe("check-in, extension, completion and cancellation", () => {
    it("records a safety confirmation without changing an active journey's ETA", async () => {
      const { user, journey } = await started();
      now += 5 * MIN;
      const next = service.transition(user.id, journey.id, "check-in", {});
      expect(next.status).toBe("active");
      expect(next.expected_arrival_at).toBe(journey.expected_arrival_at);
      expect(next.last_check_in_at).toBe(now);
      expect(next.events.at(-1)?.kind).toBe("check-in");
    });

    it("requires a new arrival time when answering a due check-in, then resumes", async () => {
      const { user, journey } = await started();
      now = journey.expected_arrival_at + MIN;
      expect(service.processOverdue()).toEqual({
        checkInDue: 1,
        escalated: 0,
        failed: 0,
      });
      expect(service.get(user.id, journey.id).status).toBe("check_in_due");
      expect(() =>
        service.transition(user.id, journey.id, "check-in", {}),
      ).toThrow(expect.objectContaining({ code: "ETA_REQUIRED" }));
      const resumed = service.transition(user.id, journey.id, "check-in", {
        expected_arrival_at: now + 20 * MIN,
      });
      expect(resumed).toMatchObject({
        status: "active",
        expected_arrival_at: now + 20 * MIN,
        check_in_due_at: null,
        last_check_in_at: now,
      });
    });

    it("accepts a fresh optional location on check-in and ignores a stale one", async () => {
      const { user, journey } = await started();
      const withLocation = service.transition(user.id, journey.id, "check-in", {
        location: {
          latitude: 19.07,
          longitude: 72.87,
          accuracy: 15,
          captured_at: now - 1000,
        },
      });
      expect(withLocation.last_known_latitude).toBe(19.07);
      const stale = service.transition(user.id, journey.id, "check-in", {
        location: {
          latitude: 1,
          longitude: 1,
          accuracy: 15,
          captured_at: now - 20 * MIN,
        },
      });
      expect(stale.last_known_latitude).toBe(19.07);
    });

    it("only allows extension to a later, valid time", async () => {
      const { user, journey } = await started();
      const call = (eta: number) =>
        service.transition(user.id, journey.id, "extend", {
          expected_arrival_at: eta,
        });
      expect(() => call(journey.expected_arrival_at)).toThrow(
        expect.objectContaining({ code: "INVALID_ETA" }),
      );
      expect(() => call(journey.expected_arrival_at - MIN)).toThrow(
        expect.objectContaining({ code: "INVALID_ETA" }),
      );
      expect(() => call(now + 25 * 60 * MIN)).toThrow(
        expect.objectContaining({ code: "INVALID_ETA" }),
      );
      expect(() =>
        service.transition(user.id, journey.id, "extend", {}),
      ).toThrow(ZodError);
      expect(
        call(journey.expected_arrival_at + 15 * MIN).expected_arrival_at,
      ).toBe(journey.expected_arrival_at + 15 * MIN);
    });

    it("an ETA extension prevents escalation against the old ETA", async () => {
      const { user, journey } = await started();
      const extended = service.transition(user.id, journey.id, "extend", {
        expected_arrival_at: journey.expected_arrival_at + 60 * MIN,
      });
      now = journey.expected_arrival_at + 10 * MIN + 1; // old ETA + grace has passed
      expect(service.processOverdue()).toEqual({
        checkInDue: 0,
        escalated: 0,
        failed: 0,
      });
      expect(service.get(user.id, journey.id)).toMatchObject({
        status: "active",
        expected_arrival_at: extended.expected_arrival_at,
      });
      expect(alertCount()).toBe(0);
    });

    it("extending from check_in_due returns to active and cancels the pending escalation", async () => {
      const { user, journey } = await started();
      now = journey.expected_arrival_at + MIN;
      service.processOverdue();
      const eta = now + 40 * MIN;
      service.transition(user.id, journey.id, "extend", {
        expected_arrival_at: eta,
      });
      now = journey.expected_arrival_at + 30 * MIN; // beyond old grace, before new ETA
      service.processOverdue();
      expect(service.get(user.id, journey.id).status).toBe("active");
      expect(alertCount()).toBe(0);
    });

    it("completion and cancellation are terminal, clear coordinates and never alert later", async () => {
      for (const action of ["complete", "cancel"] as const) {
        const { user, journey } = await started({
          location: {
            latitude: 12.97,
            longitude: 77.59,
            accuracy: 10,
            captured_at: now,
          },
        });
        const done = service.transition(user.id, journey.id, action, {});
        expect(done.status).toBe(
          action === "complete" ? "completed" : "cancelled",
        );
        expect(done.last_known_latitude).toBeNull();
        expect(done.last_known_longitude).toBeNull();
        // Repeating the same terminal action is a no-op.
        expect(service.transition(user.id, journey.id, action, {})).toEqual(
          done,
        );
        // Everything else is rejected.
        for (const other of [
          "check-in",
          "extend",
          "complete",
          "cancel",
        ] as const)
          if (other !== action)
            expect(() =>
              service.transition(
                user.id,
                journey.id,
                other,
                other === "extend"
                  ? { expected_arrival_at: now + 40 * MIN }
                  : {},
              ),
            ).toThrow(expect.objectContaining({ code: "INVALID_TRANSITION" }));
        now = journey.expected_arrival_at + 999 * MIN;
        expect(service.processOverdue()).toEqual({
          checkInDue: 0,
          escalated: 0,
          failed: 0,
        });
        expect(service.get(user.id, journey.id).alert).toBeNull();
        now = NOW;
      }
      expect(alertCount()).toBe(0);
    });

    it("rejects unknown actions and unexpected fields", async () => {
      const { user, journey } = await started();
      expect(() =>
        service.transition(user.id, journey.id, "explode" as never, {}),
      ).toThrow(expect.objectContaining({ status: 404 }));
      expect(() =>
        service.transition(user.id, journey.id, "complete", { x: 1 }),
      ).toThrow(ZodError);
    });
  });

  describe("server-side overdue processing and escalation", () => {
    it("does nothing before the ETA and prompts a check-in exactly at it", async () => {
      const { user, journey } = await started();
      now = journey.expected_arrival_at - 1;
      expect(service.processOverdue()).toEqual({
        checkInDue: 0,
        escalated: 0,
        failed: 0,
      });
      now = journey.expected_arrival_at;
      expect(service.processOverdue()).toEqual({
        checkInDue: 1,
        escalated: 0,
        failed: 0,
      });
      expect(service.processOverdue()).toEqual({
        checkInDue: 0,
        escalated: 0,
        failed: 0,
      });
      const due = service.get(user.id, journey.id);
      expect(due).toMatchObject({
        status: "check_in_due",
        check_in_due_at: now,
        alert: null,
      });
      expect(due.events.map((e) => e.kind)).toEqual([
        "started",
        "check_in_due",
      ]);
    });

    it("waits out the grace period, then escalates once and queues only sharing-enabled contacts", async () => {
      const user = await signUp(fixture);
      const a = contact(user.id, true, "9876543210");
      const b = contact(user.id, true, "9876543211");
      const journey = service.create(
        user.id,
        input([a.id, b.id], {
          destination: "Hostel\r\nGate 4",
          time_zone: "Asia/Kolkata",
        }),
      );
      // The user withdraws sharing from one contact before the escalation.
      setSharing(user.id, b, false);
      now = journey.expected_arrival_at;
      service.processOverdue();
      now = escalationDeadline(journey) - 1;
      expect(service.processOverdue().escalated).toBe(0);
      expect(alertCount()).toBe(0);
      now = escalationDeadline(journey);
      expect(service.processOverdue()).toEqual({
        checkInDue: 0,
        escalated: 1,
        failed: 0,
      });
      const escalated = service.get(user.id, journey.id);
      expect(escalated).toMatchObject({
        status: "escalated",
        escalated_at: now,
      });
      expect(escalated.alert).toMatchObject({
        kind: "journey_escalation",
        status: "queued",
      });
      expect(escalated.alert?.deliveries.map((d) => d.contact_id)).toEqual([
        a.id,
      ]);
      expect(escalated.alert?.message).toContain(
        "does not alert emergency services",
      );
      expect(escalated.alert?.message).toContain('"Hostel Gate 4"');
      expect(escalated.alert?.message).not.toMatch(/[\r\n]/);
      expect(escalated.alert?.message).toMatch(/IST/);
      // Replays and overlapping workers create no second alert.
      expect(service.processOverdue().escalated).toBe(0);
      expect(privateEscalate(user.id, journey.id, now)).toBe(false);
      expect(alertCount()).toBe(1);
      expect(provider.send).not.toHaveBeenCalled();
    });

    it("passes through check_in_due and escalates in one run when the scheduler was down", async () => {
      const { user, journey } = await started();
      now = escalationDeadline(journey) + 120 * MIN;
      expect(service.processOverdue()).toEqual({
        checkInDue: 1,
        escalated: 1,
        failed: 0,
      });
      const result = service.get(user.id, journey.id);
      expect(result.status).toBe("escalated");
      expect(result.events.map((e) => e.kind)).toEqual([
        "started",
        "check_in_due",
        "escalated",
      ]);
    });

    it("sends the queued escalation through the existing outbox and shows the real delivery outcome", async () => {
      const {
        user,
        journey,
        contact: c,
      } = await started({
        location: {
          latitude: 28.6139,
          longitude: 77.209,
          accuracy: 20,
          captured_at: NOW,
        },
      });
      now = escalationDeadline(journey);
      service.processOverdue();
      await emergency.processPending();
      expect(provider.send).toHaveBeenCalledTimes(1);
      const sent = provider.send.mock.calls[0][0];
      expect(sent.to).toBe(c.phone_number);
      expect(sent.message).toContain("Journey Guardian alert");
      expect(sent.message).toContain("Last known location captured");
      const after = service.get(user.id, journey.id);
      // A simulation result is never presented as delivery.
      expect(after.alert?.deliveries[0].status).toBe("simulated");
      expect(after.alert?.status).toBe("simulated");
      await emergency.processPending();
      expect(provider.send).toHaveBeenCalledTimes(1);
    });

    it("records provider failure truthfully while the journey stays escalated", async () => {
      provider.send.mockResolvedValue({
        status: "failed",
        code: "PROVIDER_REJECTED",
        retryable: false,
      });
      const { user, journey } = await started();
      now = escalationDeadline(journey);
      service.processOverdue();
      await emergency.processPending();
      const after = service.get(user.id, journey.id);
      expect(after.status).toBe("escalated");
      expect(after.alert).toMatchObject({ status: "failed" });
      expect(after.alert?.deliveries[0]).toMatchObject({
        status: "failed",
        code: "PROVIDER_REJECTED",
      });
    });

    it("escalates with an honest failed record when no contact still allows sharing", async () => {
      const { user, journey, contact: c } = await started();
      setSharing(user.id, c, false);
      now = escalationDeadline(journey);
      service.processOverdue();
      const after = service.get(user.id, journey.id);
      expect(after.status).toBe("escalated");
      expect(after.alert).toMatchObject({
        status: "failed",
        reason: "NO_CONTACTS",
        deliveries: [],
      });
      await emergency.processPending();
      expect(provider.send).not.toHaveBeenCalled();
    });

    it("rolls back and retries when escalation fails part-way", async () => {
      const { user, journey } = await started();
      now = escalationDeadline(journey);
      vi.spyOn(emergency, "createQueuedEvent").mockImplementationOnce(() => {
        throw new Error("simulated database failure");
      });
      expect(service.processOverdue()).toEqual({
        checkInDue: 1,
        escalated: 0,
        failed: 1,
      });
      // Nothing half-applied: still awaiting escalation, no alert, no event.
      expect(service.get(user.id, journey.id)).toMatchObject({
        status: "check_in_due",
        escalated_at: null,
        alert_id: null,
      });
      expect(alertCount()).toBe(0);
      expect(service.processOverdue()).toEqual({
        checkInDue: 0,
        escalated: 1,
        failed: 0,
      });
      expect(alertCount()).toBe(1);
      expect(service.processOverdue()).toEqual({
        checkInDue: 0,
        escalated: 0,
        failed: 0,
      });
    });

    it("one failing journey does not block the others", async () => {
      const first = await started();
      const second = await started();
      now = escalationDeadline(first.journey);
      const original = emergency.createQueuedEvent.bind(emergency);
      let call = 0;
      vi.spyOn(emergency, "createQueuedEvent").mockImplementation((...args) => {
        if (call++ === 0) throw new Error("boom");
        return original(...args);
      });
      const result = service.processOverdue();
      expect(result).toMatchObject({ checkInDue: 2, escalated: 1, failed: 1 });
      const statuses = [first, second].map(
        (j) => service.get(j.user.id, j.journey.id).status,
      );
      expect(statuses.sort()).toEqual(["check_in_due", "escalated"]);
    });
  });

  describe("concurrent transitions", () => {
    it("a stale scheduler snapshot cannot escalate a journey that was extended meanwhile", async () => {
      const { user, journey } = await started();
      now = journey.expected_arrival_at + MIN;
      service.processOverdue(); // check_in_due
      service.transition(user.id, journey.id, "extend", {
        expected_arrival_at: now + 60 * MIN,
      });
      // The scheduler had already selected the journey; replaying its step must be a no-op.
      now = escalationDeadline(journey) + MIN;
      expect(privateEscalate(user.id, journey.id, now)).toBe(false);
      expect(service.get(user.id, journey.id).status).toBe("active");
      expect(alertCount()).toBe(0);
    });

    it("never escalates before ETA plus grace, even if a worker with a skewed clock asks to", async () => {
      const { user, journey } = await started();
      now = journey.expected_arrival_at;
      service.processOverdue(); // check_in_due, grace still running
      expect(
        privateEscalate(user.id, journey.id, escalationDeadline(journey) - 1),
      ).toBe(false);
      expect(service.get(user.id, journey.id).status).toBe("check_in_due");
      expect(alertCount()).toBe(0);
    });

    it("a stale scheduler snapshot cannot prompt a check-in for a journey whose ETA was extended", async () => {
      const { user, journey } = await started();
      service.transition(user.id, journey.id, "extend", {
        expected_arrival_at: journey.expected_arrival_at + 60 * MIN,
      });
      now = journey.expected_arrival_at + MIN; // old ETA passed, new ETA has not
      expect(privateCheckInDue(user.id, journey.id, now)).toBe(false);
      expect(service.get(user.id, journey.id).status).toBe("active");
    });

    it("an active journey can only be escalated after passing through check_in_due", async () => {
      const { user, journey } = await started();
      now = escalationDeadline(journey) + MIN;
      expect(privateEscalate(user.id, journey.id, now)).toBe(false);
      expect(service.get(user.id, journey.id).status).toBe("active");
      expect(alertCount()).toBe(0);
    });

    it("completing first wins over a pending escalation, and escalation first allows a clean completion", async () => {
      const a = await started();
      now = escalationDeadline(a.journey) - 1;
      service.processOverdue(); // check_in_due
      service.transition(a.user.id, a.journey.id, "complete", {});
      now = escalationDeadline(a.journey) + MIN;
      expect(privateEscalate(a.user.id, a.journey.id, now)).toBe(false);
      expect(service.processOverdue().escalated).toBe(0);
      expect(service.get(a.user.id, a.journey.id).status).toBe("completed");
      expect(alertCount()).toBe(0);

      const b = await started();
      now = escalationDeadline(b.journey) + MIN;
      service.processOverdue();
      const finished = service.transition(
        b.user.id,
        b.journey.id,
        "complete",
        {},
      );
      expect(finished.status).toBe("completed");
      expect(finished.alert_id).not.toBeNull(); // escalation really happened
      expect(alertCount()).toBe(2); // escalation + all-clear
    });

    it("racing duplicate check-ins and completes leave one consistent state", async () => {
      const { user, journey } = await started();
      const results = await Promise.allSettled([
        Promise.resolve().then(() =>
          service.transition(user.id, journey.id, "complete", {}),
        ),
        Promise.resolve().then(() =>
          service.transition(user.id, journey.id, "complete", {}),
        ),
        Promise.resolve().then(() =>
          service.transition(user.id, journey.id, "cancel", {}),
        ),
      ]);
      const final = service.get(user.id, journey.id);
      expect(final.status).toBe("completed");
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
      expect(final.events.filter((e) => e.kind === "complete")).toHaveLength(1);
    });
  });

  describe("all-clear notice after an escalation", () => {
    async function escalatedJourney() {
      const world = await started();
      now = escalationDeadline(world.journey);
      service.processOverdue();
      await emergency.processPending();
      provider.send.mockClear();
      return world;
    }

    it("tells the same contacts once, with the user's own words and no location suffix", async () => {
      const { user, journey } = await escalatedJourney();
      const done = await service.transitionAndNotify(
        user.id,
        journey.id,
        "complete",
        {},
      );
      expect(done.status).toBe("completed");
      expect(provider.send).toHaveBeenCalledTimes(1);
      const message = provider.send.mock.calls[0][0].message;
      expect(message).toContain("marked complete by the user");
      expect(message).toContain("not an independent confirmation");
      expect(message).not.toContain("Location unavailable");
      const settled = service.get(user.id, journey.id);
      expect(settled.all_clear_alert_id).not.toBeNull();
      await service.transitionAndNotify(user.id, journey.id, "complete", {});
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(alertCount()).toBe(2);
    });

    it("uses cautious wording when the journey is cancelled after escalation", async () => {
      const { user, journey } = await escalatedJourney();
      await service.transitionAndNotify(user.id, journey.id, "cancel", {});
      expect(provider.send.mock.calls[0][0].message).toContain(
        "please contact them to confirm they are safe",
      );
    });

    it("sends nothing when the journey never escalated", async () => {
      const { user, journey } = await started();
      await service.transitionAndNotify(user.id, journey.id, "complete", {});
      expect(provider.send).not.toHaveBeenCalled();
      expect(alertCount()).toBe(0);
    });

    it("keeps the journey closed even if the immediate all-clear send fails", async () => {
      const { user, journey } = await escalatedJourney();
      vi.spyOn(emergency, "dispatchQueued").mockRejectedValue(
        new Error("down"),
      );
      const done = await service.transitionAndNotify(
        user.id,
        journey.id,
        "complete",
        {},
      );
      expect(done.status).toBe("completed");
      // The scheduled job still sends it.
      await emergency.processPending();
      expect(provider.send).toHaveBeenCalledTimes(1);
    });
  });

  describe("limits, retention and history", () => {
    it("rate-limits repeated actions per user", async () => {
      const { user, journey } = await started();
      for (let i = 0; i < 60; i++)
        service.transition(user.id, journey.id, "check-in", {});
      expect(() =>
        service.transition(user.id, journey.id, "check-in", {}),
      ).toThrow(expect.objectContaining({ status: 429, code: "RATE_LIMIT" }));
    });

    it("retention drops finished journeys after 30 days and strips stray coordinates", async () => {
      const done = await started();
      service.transition(done.user.id, done.journey.id, "complete", {});
      const open = await started({
        location: {
          latitude: 12.97,
          longitude: 77.59,
          accuracy: 10,
          captured_at: now,
        },
      });
      fixture.db
        .prepare(
          "UPDATE journeys SET last_known_latitude=1,last_known_longitude=1 WHERE id=?",
        )
        .run(done.journey.id);
      applyRetention(fixture.db, now + MIN);
      expect(
        fixture.db
          .prepare("SELECT last_known_latitude AS v FROM journeys WHERE id=?")
          .get(done.journey.id),
      ).toEqual({ v: null });
      expect(
        (
          fixture.db
            .prepare("SELECT last_known_latitude AS v FROM journeys WHERE id=?")
            .get(open.journey.id) as { v: number }
        ).v,
      ).toBe(12.97);
      applyRetention(fixture.db, now + 31 * 86_400_000);
      expect(
        rows("SELECT id FROM journeys WHERE id=?", done.journey.id),
      ).toHaveLength(0);
      expect(
        rows("SELECT id FROM journeys WHERE id=?", open.journey.id),
      ).toHaveLength(1);
    });

    it("never stores contact numbers or message bodies in the audit trail", async () => {
      const { user, journey } = await started();
      now = escalationDeadline(journey);
      service.processOverdue();
      const audit = JSON.stringify(
        rows(
          "SELECT action,resource_id FROM audit_events WHERE user_id=?",
          user.id,
        ),
      );
      expect(audit).toContain("journey.escalated");
      expect(audit).not.toContain("+91");
      expect(audit).not.toContain("Journey Guardian");
    });
  });

  describe("HTTP API", () => {
    function request(
      method: string,
      path: string,
      options: {
        cookie?: string;
        input?: unknown;
        origin?: string | null;
      } = {},
    ) {
      const headers = new Headers({ "content-type": "application/json" });
      if (options.cookie) headers.set("cookie", options.cookie);
      if (options.origin !== null)
        headers.set("origin", options.origin ?? TEST_ORIGIN);
      return new Request(`${TEST_ORIGIN}/api/journeys${path}`, {
        method,
        headers,
        body:
          options.input === undefined
            ? undefined
            : JSON.stringify(options.input),
      });
    }
    // Routes use the real clock, so API inputs are relative to Date.now().
    const apiInput = (
      contactIds: string[],
      over: Record<string, unknown> = {},
    ) => ({
      idempotency_key: randomUUID(),
      destination: "College",
      expected_arrival_at: Date.now() + 30 * MIN,
      grace_period_minutes: 10,
      contact_ids: contactIds,
      consent: true,
      ...over,
    });
    const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
    const actionCtx = (id: string, action: string) => ({
      params: Promise.resolve({ id, action }),
    });

    it("requires a session and an exact same-origin header for writes", async () => {
      const user = await signUp(fixture);
      const c = contact(user.id);
      let response = await listJourneys(request("GET", ""));
      expect(response.status).toBe(401);
      response = await createJourney(
        request("POST", "", { input: apiInput([c.id]) }),
      );
      expect(response.status).toBe(401); // correct origin but no session
      response = await createJourney(
        request("POST", "", {
          cookie: user.cookie,
          origin: "https://evil.example",
          input: apiInput([c.id]),
        }),
      );
      expect(response.status).toBe(403);
      expect(rows("SELECT id FROM journeys")).toHaveLength(0);
    });

    it("creates, reads, acts on and lists a journey for its owner only", async () => {
      const alice = await signUp(fixture);
      const bob = await signUp(fixture);
      const c = contact(alice.id);
      const created = await createJourney(
        request("POST", "", { cookie: alice.cookie, input: apiInput([c.id]) }),
      );
      expect(created.status).toBe(201);
      const { data: journey } = await created.json();
      expect(journey).toMatchObject({ status: "active", user_id: alice.id });

      const own = await getJourney(
        request("GET", `/${journey.id}`, { cookie: alice.cookie }),
        idCtx(journey.id),
      );
      expect(own.status).toBe(200);
      for (const response of [
        await getJourney(
          request("GET", `/${journey.id}`, { cookie: bob.cookie }),
          idCtx(journey.id),
        ),
        await journeyAction(
          request("POST", `/${journey.id}/complete`, {
            cookie: bob.cookie,
            input: {},
          }),
          actionCtx(journey.id, "complete"),
        ),
        await journeyAction(
          request("POST", `/${journey.id}/extend`, {
            cookie: bob.cookie,
            input: { expected_arrival_at: Date.now() + 40 * MIN },
          }),
          actionCtx(journey.id, "extend"),
        ),
      ])
        expect(response.status).toBe(404);
      const bobList = await (
        await listJourneys(request("GET", "", { cookie: bob.cookie }))
      ).json();
      expect(bobList.data).toEqual([]);

      const bad = await journeyAction(
        request("POST", `/${journey.id}/explode`, {
          cookie: alice.cookie,
          input: {},
        }),
        actionCtx(journey.id, "explode"),
      );
      expect(bad.status).toBe(400);

      const done = await journeyAction(
        request("POST", `/${journey.id}/complete`, {
          cookie: alice.cookie,
          input: {},
        }),
        actionCtx(journey.id, "complete"),
      );
      expect(done.status).toBe(200);
      expect((await done.json()).data.status).toBe("completed");
      const aliceList = await (
        await listJourneys(request("GET", "", { cookie: alice.cookie }))
      ).json();
      expect(aliceList.data.map((j: { id: string }) => j.id)).toEqual([
        journey.id,
      ]);
    });

    it("returns validation and conflict errors without leaking internals", async () => {
      const user = await signUp(fixture);
      const c = contact(user.id);
      const invalid = await createJourney(
        request("POST", "", {
          cookie: user.cookie,
          input: apiInput([c.id], { destination: "" }),
        }),
      );
      expect(invalid.status).toBe(400);
      expect((await invalid.json()).error.code).toBe("INVALID_INPUT");
      await createJourney(
        request("POST", "", { cookie: user.cookie, input: apiInput([c.id]) }),
      );
      const second = await createJourney(
        request("POST", "", { cookie: user.cookie, input: apiInput([c.id]) }),
      );
      expect(second.status).toBe(409);
      const text = JSON.stringify(await second.json());
      expect(text).not.toMatch(/SELECT|sqlite|stack/i);
    });

    it("the protected job processes overdue journeys and sends the escalation via the provider", async () => {
      const realNow = Date.now();
      const user = await signUp(fixture);
      const c = contact(user.id);
      // Journey started two hours ago, using the real clock for the job run.
      const past = new JourneyService(
        fixture.db,
        emergency,
        () => realNow - 120 * MIN,
      );
      const journey = past.create(
        user.id,
        input([c.id], {
          expected_arrival_at: realNow - 90 * MIN,
          grace_period_minutes: 10,
        }),
      );
      // The job route builds its services with the real clock.
      const jobSecret = randomBytes(48).toString("base64url");
      vi.stubEnv("JOB_SECRET", jobSecret);
      const denied = await processJobs(
        new Request(`${TEST_ORIGIN}/api/internal/jobs`, { method: "POST" }),
      );
      expect(denied.status).toBe(401);
      expect(provider.send).not.toHaveBeenCalled();
      const run = await processJobs(
        new Request(`${TEST_ORIGIN}/api/internal/jobs`, {
          method: "POST",
          headers: { authorization: `Bearer ${jobSecret}` },
        }),
      );
      expect(run.status).toBe(200);
      const body = (await run.json()).data;
      expect(body.journeys).toEqual({ checkInDue: 1, escalated: 1, failed: 0 });
      expect(provider.send).toHaveBeenCalledTimes(1);
      const after = past.get(user.id, journey.id);
      expect(after.status).toBe("escalated");
      expect(after.alert?.deliveries[0].status).toBe("simulated");
      // Re-running the job does not send again.
      await processJobs(
        new Request(`${TEST_ORIGIN}/api/internal/jobs`, {
          method: "POST",
          headers: { authorization: `Bearer ${jobSecret}` },
        }),
      );
      expect(provider.send).toHaveBeenCalledTimes(1);
    });

    it("reports whether the scheduled job has run, only to signed-in users", async () => {
      const user = await signUp(fixture);
      expect((await getMonitor(request("GET", "/monitor"))).status).toBe(401);
      const read = async () =>
        (
          await (
            await getMonitor(
              request("GET", "/monitor", { cookie: user.cookie }),
            )
          ).json()
        ).data;
      expect(await read()).toEqual({ state: "never", last_run_at: null });
      const jobSecret = randomBytes(48).toString("base64url");
      vi.stubEnv("JOB_SECRET", jobSecret);
      const run = await processJobs(
        new Request(`${TEST_ORIGIN}/api/internal/jobs`, {
          method: "POST",
          headers: { authorization: `Bearer ${jobSecret}` },
        }),
      );
      expect(run.status).toBe(200);
      expect((await read()).state).toBe("ok");
      fixture.db
        .prepare("UPDATE job_heartbeats SET last_run_at=?")
        .run(Date.now() - 10 * MIN);
      expect((await read()).state).toBe("stale");
    });

    it("labels journey notifications by kind in the shared alert history", async () => {
      const realNow = Date.now();
      const user = await signUp(fixture);
      const c = contact(user.id);
      const past = new JourneyService(
        fixture.db,
        emergency,
        () => realNow - 120 * MIN,
      );
      past.create(
        user.id,
        input([c.id], { expected_arrival_at: realNow - 90 * MIN }),
      );
      const live = new JourneyService(fixture.db, emergency, () => realNow);
      live.processOverdue();
      const history = await (
        await listAlerts(request("GET", "", { cookie: user.cookie }))
      ).json();
      expect(history.data[0]).toMatchObject({ kind: "journey_escalation" });
    });

    it("surfaces AppError status codes unchanged (sanity for 404 on unknown id)", async () => {
      const user = await signUp(fixture);
      expect(() => service.get(user.id, randomUUID())).toThrow(AppError);
    });
  });
  describe("one-tap share", () => {
    const loc = () => ({
      latitude: 12.9716,
      longitude: 77.5946,
      accuracy: 20,
      captured_at: now - 5000,
    });

    it("sends ETA, route summary and live location to the journey's contacts, and stores no coordinates", async () => {
      const { user, journey } = await started({
        origin: "Koramangala",
        destination: "Indiranagar",
        time_zone: "Asia/Kolkata",
      });
      const result = await service.share(user.id, journey.id, {
        idempotency_key: randomUUID(),
        route_summary: "Safest route, 6.4 km, 8 min by cab",
        location: loc(),
      });
      expect(result).toMatchObject({
        journey_id: journey.id,
        shared_location: true,
        deliveries: [
          { contact_name: "Synthetic Contact", status: "simulated" },
        ],
      });
      const sent = provider.send.mock.calls.at(-1)![0].message;
      expect(sent).toContain("Indiranagar");
      expect(sent).toContain("ETA");
      expect(sent).toContain("Safest route, 6.4 km");
      expect(sent).toContain("maps.google.com/?q=12.9716,77.5946");
      expect(sent).toContain("does not alert emergency services");
      expect(
        JSON.stringify(rows("SELECT * FROM journey_shares")),
      ).not.toContain("12.97");
    });

    it("sends without location when none is given or it is stale, and says so", async () => {
      const { user, journey } = await started();
      const stale = { ...loc(), captured_at: now - 10 * MIN };
      for (const location of [null, stale]) {
        const r = await service.share(user.id, journey.id, {
          idempotency_key: randomUUID(),
          location,
        });
        expect(r.shared_location).toBe(false);
        expect(provider.send.mock.calls.at(-1)![0].message).toContain(
          "Live location unavailable",
        );
      }
    });

    it("does not message twice for a retried request, but each new tap sends an update", async () => {
      const { user, journey } = await started();
      const key = randomUUID();
      const a = await service.share(user.id, journey.id, {
        idempotency_key: key,
      });
      const b = await service.share(user.id, journey.id, {
        idempotency_key: key,
      });
      expect(b.id).toBe(a.id);
      expect(provider.send).toHaveBeenCalledTimes(1);
      await service.share(user.id, journey.id, {
        idempotency_key: randomUUID(),
      });
      expect(provider.send).toHaveBeenCalledTimes(2);
    });

    it("refuses a finished journey, someone else's journey and contacts who stopped sharing", async () => {
      const { user, journey, contact: c } = await started();
      const other = await signUp(fixture);
      await expect(
        service.share(other.id, journey.id, { idempotency_key: randomUUID() }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      setSharing(user.id, c, false);
      await expect(
        service.share(user.id, journey.id, { idempotency_key: randomUUID() }),
      ).rejects.toMatchObject({ code: "NO_CONTACTS" });
      setSharing(user.id, c, true);
      service.transition(user.id, journey.id, "complete", {});
      await expect(
        service.share(user.id, journey.id, { idempotency_key: randomUUID() }),
      ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
      expect(provider.send).not.toHaveBeenCalled();
    });
  });
});
