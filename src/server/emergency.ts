import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  Alert,
  AlertKind,
  AlertStatus,
  Delivery,
} from "@/lib/emergency-types";
import { audit, throttle } from "./audit";
import { AppError } from "./http";
import { sendBounded, type NotificationProvider } from "./notifications";
import type { Location } from "@/lib/emergency-types";

export const locationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100000),
    captured_at: z.number().int().positive(),
  })
  .strict();
const createSchema = z
  .object({ idempotency_key: z.uuid(), consent: z.literal(true) })
  .strict();
const dispatchSchema = z
  .object({ location: locationSchema.nullable().default(null) })
  .strict();
type AlertRow = Omit<Alert, "deliveries">;
type DeliveryRow = Delivery & {
  alert_id: string;
  retryable: number;
  next_attempt_at: number;
};
export class EmergencyService {
  constructor(
    private db: Database.Database,
    private provider: NotificationProvider,
    private clock = Date.now,
  ) {}
  get(userId: string, id: string): Alert {
    const row = this.db
      .prepare(
        "SELECT id,user_id,kind,status,reason,latitude,longitude,location_accuracy_meters,location_captured_at,message,created_at,updated_at FROM alerts WHERE id=? AND user_id=?",
      )
      .get(id, userId) as AlertRow | undefined;
    if (!row) throw new AppError(404, "NOT_FOUND", "Alert not found.");
    const deliveries = this.db
      .prepare(
        "SELECT id,contact_id,status,code,attempt_count,updated_at FROM deliveries WHERE alert_id=? ORDER BY created_at,id",
      )
      .all(id) as Delivery[];
    return { ...row, deliveries };
  }
  list(userId: string) {
    return (
      this.db
        .prepare(
          "SELECT id FROM alerts WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
        )
        .all(userId) as { id: string }[]
    ).map(({ id }) => this.get(userId, id));
  }
  create(userId: string, input: unknown) {
    const data = createSchema.parse(input);
    return this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT id FROM alerts WHERE user_id=? AND idempotency_key=?")
        .get(userId, data.idempotency_key) as { id: string } | undefined;
      if (existing) return this.get(userId, existing.id);
      throttle(this.db, userId, "sos", 10, this.clock());
      const contacts = this.db
        .prepare("SELECT id FROM contacts WHERE user_id=? AND alert_enabled=1")
        .all(userId) as { id: string }[];
      return this.createEvent(
        userId,
        data.idempotency_key,
        contacts.map((c) => c.id),
        "SAKHI SOS: Your trusted contact is asking for help. Please contact them. This message does not alert emergency services.",
      );
    })();
  }
  // Called inside the caller's transaction; selected recipients are ownership-checked again.
  createEvent(
    userId: string,
    key: string,
    contactIds: string[],
    message: string,
    kind: AlertKind = "sos",
  ): Alert {
    const existing = this.db
      .prepare("SELECT id FROM alerts WHERE user_id=? AND idempotency_key=?")
      .get(userId, key) as { id: string } | undefined;
    if (existing) return this.get(userId, existing.id);
    const id = randomUUID(),
      now = this.clock();
    this.db
      .prepare(
        "INSERT INTO alerts(id,user_id,idempotency_key,status,reason,message,kind,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        userId,
        key,
        contactIds.length ? "created" : "failed",
        contactIds.length ? null : "NO_CONTACTS",
        message,
        kind,
        now,
        now,
      );
    for (const contactId of new Set(contactIds)) {
      if (
        !this.db
          .prepare("SELECT 1 FROM contacts WHERE id=? AND user_id=?")
          .get(contactId, userId)
      )
        throw new AppError(
          400,
          "CONTACT_SELECTION",
          "Select only your own contacts.",
        );
      this.db
        .prepare(
          "INSERT INTO deliveries(id,alert_id,contact_id,status,next_attempt_at,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?)",
        )
        .run(randomUUID(), id, contactId, now, now, now);
    }
    audit(this.db, userId, "sos.created", id, now);
    return this.get(userId, id);
  }
  /**
   * One immediate message to one of the user's sharing-enabled contacts, for
   * user-initiated updates (such as sharing a journey). No retries: the caller
   * records the outcome and the user can simply send again.
   */
  async notifyContact(
    userId: string,
    contactId: string,
    message: string,
    idempotencyKey: string,
  ) {
    const contact = this.db
      .prepare(
        "SELECT phone_number FROM contacts WHERE id=? AND user_id=? AND alert_enabled=1",
      )
      .get(contactId, userId) as { phone_number: string } | undefined;
    if (!contact)
      return {
        status: "failed" as const,
        code: "CONTACT_UNAVAILABLE",
        retryable: false,
      };
    const sender = this.db
      .prepare("SELECT name FROM user WHERE id=?")
      .get(userId) as { name: string };
    return sendBounded(this.provider, {
      to: contact.phone_number,
      message: `From ${sender.name.replace(/[\r\n]/g, " ").slice(0, 80)}: ${message}`,
      idempotencyKey,
    });
  }
  // System-initiated alerts (journey escalation / all-clear): recipients are
  // already decided by the caller, so the alert is queued for the outbox
  // immediately instead of waiting for a browser dispatch call. Idempotent per
  // key. Must run inside the caller's transaction.
  createQueuedEvent(
    userId: string,
    key: string,
    contactIds: string[],
    message: string,
    kind: Exclude<AlertKind, "sos">,
    location: Location | null = null,
  ): Alert {
    const alert = this.createEvent(userId, key, contactIds, message, kind);
    if (alert.status !== "created") return alert;
    this.db
      .prepare(
        "UPDATE alerts SET status='queued',latitude=?,longitude=?,location_accuracy_meters=?,location_captured_at=?,updated_at=? WHERE id=? AND user_id=? AND status='created'",
      )
      .run(
        location?.latitude ?? null,
        location?.longitude ?? null,
        location?.accuracy ?? null,
        location?.captured_at ?? null,
        this.clock(),
        alert.id,
        userId,
      );
    return this.get(userId, alert.id);
  }
  // Best-effort immediate send of an already-queued alert. Anything left
  // unsent is picked up by processPending().
  async dispatchQueued(userId: string, id: string) {
    await this.dispatchRows(userId, id);
    return this.get(userId, id);
  }
  async dispatch(userId: string, id: string, input: unknown) {
    const data = dispatchSchema.parse(input);
    const now = this.clock();
    if (
      data.location &&
      (data.location.captured_at < now - 300000 ||
        data.location.captured_at > now + 30000)
    )
      throw new AppError(
        400,
        "LOCATION_TIME",
        "Location is stale or has an invalid capture time. Continue without location.",
      );
    this.db.transaction(() => {
      const alert = this.get(userId, id);
      if (alert.status !== "created") return;
      const loc = data.location;
      this.db
        .prepare(
          "UPDATE alerts SET status='queued',latitude=?,longitude=?,location_accuracy_meters=?,location_captured_at=?,updated_at=? WHERE id=? AND user_id=? AND status='created'",
        )
        .run(
          loc?.latitude ?? null,
          loc?.longitude ?? null,
          loc?.accuracy ?? null,
          loc?.captured_at ?? null,
          now,
          id,
          userId,
        );
    })();
    await this.dispatchRows(userId, id);
    return this.get(userId, id);
  }
  private async dispatchRows(userId: string, id: string) {
    const alert = this.get(userId, id);
    if (alert.status === "created") return;
    const candidates = this.db
      .prepare(
        "SELECT * FROM deliveries WHERE alert_id=? AND (status='queued' OR (status='failed' AND retryable=1 AND attempt_count<3)) AND next_attempt_at<=?",
      )
      .all(id, this.clock()) as DeliveryRow[];
    // At most20 configured contacts; bounded parallel sends prevent one timeout blocking all recipients.
    await Promise.all(
      candidates.map(async (delivery) => {
        const attempt = this.db.transaction(() => {
          const claimed = this.db
            .prepare(
              "UPDATE deliveries SET status='sending',attempt_count=attempt_count+1,updated_at=? WHERE id=? AND (status='queued' OR (status='failed' AND retryable=1 AND attempt_count<3)) AND next_attempt_at<=? RETURNING attempt_count",
            )
            .get(this.clock(), delivery.id, this.clock()) as
            { attempt_count: number } | undefined;
          if (!claimed) return null;
          this.db
            .prepare(
              "INSERT INTO delivery_attempts(id,delivery_id,attempt_number,status,started_at) VALUES(?,?,?,'sending',?)",
            )
            .run(
              randomUUID(),
              delivery.id,
              claimed.attempt_count,
              this.clock(),
            );
          this.aggregate(id);
          return claimed.attempt_count;
        })();
        if (!attempt) return;
        const contact = this.db
          .prepare(
            "SELECT phone_number FROM contacts WHERE id=? AND user_id=? AND alert_enabled=1",
          )
          .get(delivery.contact_id, userId) as
          { phone_number: string } | undefined;
        const locationText =
          alert.kind === "journey_all_clear"
            ? ""
            : alert.latitude !== null
              ? ` Last known location captured ${new Date(alert.location_captured_at!).toISOString()} (accuracy ${alert.location_accuracy_meters}m): https://maps.google.com/?q=${alert.latitude},${alert.longitude}`
              : " Location unavailable.";
        const sender = this.db
          .prepare("SELECT name FROM user WHERE id=?")
          .get(userId) as { name: string };
        const senderName = sender.name.replace(/[\r\n]/g, " ").slice(0, 80);
        const result = contact
          ? await sendBounded(this.provider, {
              to: contact.phone_number,
              message: `From ${senderName}: ${alert.message}${locationText}`,
              idempotencyKey: delivery.id,
            })
          : {
              status: "failed" as const,
              code: "CONTACT_UNAVAILABLE",
              retryable: false,
            };
        this.db.transaction(() => {
          const update = this.db
            .prepare(
              "UPDATE deliveries SET status=?,code=?,retryable=?,provider_id=?,next_attempt_at=?,updated_at=? WHERE id=? AND status='sending' AND attempt_count=?",
            )
            .run(
              result.status,
              result.code ?? null,
              +(result.status === "failed" && !!result.retryable),
              result.providerId ?? null,
              this.clock() + 60000,
              this.clock(),
              delivery.id,
              attempt,
            );
          if (!update.changes) return;
          this.db
            .prepare(
              "UPDATE delivery_attempts SET status=?,code=?,finished_at=? WHERE delivery_id=? AND attempt_number=?",
            )
            .run(
              result.status,
              result.code ?? null,
              this.clock(),
              delivery.id,
              attempt,
            );
          audit(
            this.db,
            userId,
            `notification.${result.status}`,
            delivery.id,
            this.clock(),
          );
          this.aggregate(id);
        })();
      }),
    );
    this.aggregate(id);
  }
  private aggregate(id: string) {
    const rows = this.db
      .prepare("SELECT status FROM deliveries WHERE alert_id=?")
      .all(id) as Delivery[];
    if (!rows.length) return;
    const states = rows.map((r) => r.status);
    const state: AlertStatus = states.includes("sending")
      ? "sending"
      : states.includes("queued")
        ? "queued"
        : states.every((s) => s === states[0])
          ? states[0]
          : states.includes("unknown")
            ? "unknown"
            : "partial";
    this.db
      .prepare("UPDATE alerts SET status=?,updated_at=? WHERE id=?")
      .run(state, this.clock(), id);
  }
  async processPending() {
    const now = this.clock();
    this.db.transaction(() => {
      const interrupted = this.db
        .prepare(
          "SELECT DISTINCT alert_id FROM deliveries WHERE status='sending' AND updated_at<=?",
        )
        .all(now - 30000) as { alert_id: string }[];
      this.db
        .prepare(
          "UPDATE delivery_attempts SET status='unknown',code='WORKER_INTERRUPTED',finished_at=? WHERE status='sending' AND started_at<=?",
        )
        .run(now, now - 30000);
      this.db
        .prepare(
          "UPDATE deliveries SET status='unknown',code='WORKER_INTERRUPTED',retryable=0,updated_at=? WHERE status='sending' AND updated_at<=?",
        )
        .run(now, now - 30000);
      this.db
        .prepare(
          "UPDATE alerts SET status='queued',updated_at=? WHERE status='created' AND created_at<=?",
        )
        .run(now, now - 15000);
      for (const row of interrupted) this.aggregate(row.alert_id);
      // Reconcile historical interrupted runs where recipient results were durable
      // but their parent summary was not yet updated. Never resend terminal rows.
      const staleParents = this.db
        .prepare(
          "SELECT id FROM alerts WHERE status IN ('queued','sending') AND NOT EXISTS (SELECT 1 FROM deliveries WHERE alert_id=alerts.id AND status IN ('queued','sending'))",
        )
        .all() as { id: string }[];
      for (const row of staleParents) this.aggregate(row.id);
    })();
    const rows = this.db
      .prepare(
        `SELECT id,user_id FROM alerts WHERE status != 'created' AND EXISTS (
      SELECT 1 FROM deliveries WHERE alert_id=alerts.id AND next_attempt_at<=? AND
      (status='queued' OR (status='failed' AND retryable=1 AND attempt_count<3))) ORDER BY created_at ASC LIMIT 100`,
      )
      .all(now) as { id: string; user_id: string }[];
    for (const row of rows) {
      await this.dispatchRows(row.user_id, row.id);
      this.aggregate(row.id);
    }
    return { processed: rows.length };
  }
}
