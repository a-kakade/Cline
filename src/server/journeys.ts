import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ACTION_ALLOWED,
  JOURNEY_ACTIONS,
  MAX_ETA_MS,
  MIN_ETA_MS,
  OPEN_STATUSES,
  statusAfter,
} from "@/lib/journey-state";
import type {
  Journey,
  JourneyAction,
  JourneyEventKind,
  JourneyShare,
} from "@/lib/journey-types";
import type { Location } from "@/lib/emergency-types";
import { EmergencyService, locationSchema } from "./emergency";
import { AppError } from "./http";
import { audit, throttle } from "./audit";

const validTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat("en-IN", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};
const createSchema = z
  .object({
    idempotency_key: z.uuid(),
    destination: z
      .string()
      .trim()
      .min(1, "Enter a destination.")
      .max(200, "Destination must be at most 200 characters."),
    origin: z.string().trim().max(200).optional(),
    expected_arrival_at: z.number().int().positive(),
    grace_period_minutes: z.number().int().min(1).max(60),
    time_zone: z
      .string()
      .trim()
      .max(64)
      .refine(validTimeZone, "Unknown time zone.")
      .optional(),
    contact_ids: z
      .array(z.uuid())
      .min(1, "Select at least one trusted contact.")
      .max(20)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Select each contact only once.",
      ),
    consent: z.literal(true),
    location: locationSchema.nullable().optional(),
  })
  .strict();
const checkInSchema = z
  .object({
    expected_arrival_at: z.number().int().positive().optional(),
    location: locationSchema.nullable().optional(),
  })
  .strict();
const extendSchema = z
  .object({ expected_arrival_at: z.number().int().positive() })
  .strict();
const emptySchema = z.object({}).strict();
const shareSchema = z
  .object({
    idempotency_key: z.uuid(),
    route_summary: z.string().trim().max(240).optional(),
    location: locationSchema.nullable().optional(),
  })
  .strict();

type JourneyRow = Omit<Journey, "contact_ids" | "events" | "alert">;
const JOURNEY_COLUMNS =
  "id,user_id,status,origin,destination,expected_arrival_at,grace_period_minutes,time_zone,last_known_latitude,last_known_longitude,last_location_accuracy_meters,last_location_updated_at,started_at,check_in_due_at,last_check_in_at,completed_at,cancelled_at,escalated_at,alert_id,all_clear_alert_id,created_at,updated_at";

// Text placed in SMS bodies: no control characters, bounded length.
const clean = (value: string, max: number) =>
  value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, max);
function formatTime(ms: number, timeZone: string | null) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: timeZone ?? "UTC",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(ms));
}

export type OverdueResult = {
  checkInDue: number;
  escalated: number;
  failed: number;
};

export class JourneyService {
  constructor(
    private db: Database.Database,
    private emergency: EmergencyService,
    private clock = Date.now,
  ) {}

  private row(userId: string, id: string): JourneyRow {
    const row = this.db
      .prepare(
        `SELECT ${JOURNEY_COLUMNS} FROM journeys WHERE id=? AND user_id=?`,
      )
      .get(id, userId) as JourneyRow | undefined;
    if (!row) throw new AppError(404, "NOT_FOUND", "Journey not found.");
    return row;
  }
  get(userId: string, id: string): Journey {
    const row = this.row(userId, id);
    return {
      ...row,
      contact_ids: (
        this.db
          .prepare(
            "SELECT contact_id FROM journey_contacts WHERE journey_id=? AND user_id=?",
          )
          .all(id, userId) as { contact_id: string }[]
      ).map((c) => c.contact_id),
      events: this.db
        .prepare(
          "SELECT kind,created_at FROM journey_events WHERE journey_id=? ORDER BY created_at,rowid",
        )
        .all(id) as Journey["events"],
      alert: row.alert_id ? this.emergency.get(userId, row.alert_id) : null,
    };
  }
  list(userId: string) {
    return (
      this.db
        .prepare(
          "SELECT id FROM journeys WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
        )
        .all(userId) as { id: string }[]
    ).map((row) => this.get(userId, row.id));
  }
  private validateEta(eta: number) {
    const now = this.clock();
    if (eta < now + MIN_ETA_MS || eta > now + MAX_ETA_MS)
      throw new AppError(
        400,
        "INVALID_ETA",
        "Choose an arrival time between one minute and 24 hours from now.",
      );
  }
  private event(userId: string, id: string, kind: JourneyEventKind) {
    this.db
      .prepare("INSERT INTO journey_events VALUES(?,?,?,?)")
      .run(randomUUID(), id, kind, this.clock());
    audit(this.db, userId, `journey.${kind}`, id, this.clock());
  }
  /** Contacts the user selected for this journey who still allow sharing. */
  private sharingContactIds(userId: string, id: string) {
    return (
      this.db
        .prepare(
          `SELECT jc.contact_id FROM journey_contacts jc
           JOIN contacts c ON c.id=jc.contact_id AND c.user_id=jc.user_id
           WHERE jc.journey_id=? AND jc.user_id=? AND c.alert_enabled=1
           ORDER BY jc.contact_id`,
        )
        .all(id, userId) as { contact_id: string }[]
    ).map((r) => r.contact_id);
  }

  private shareRecord(userId: string, shareId: string): JourneyShare {
    const row = this.db
      .prepare(
        `SELECT s.id,s.journey_id,s.created_at,s.shared_location,j.expected_arrival_at
         FROM journey_shares s JOIN journeys j ON j.id=s.journey_id
         WHERE s.id=? AND s.user_id=?`,
      )
      .get(shareId, userId) as {
      id: string;
      journey_id: string;
      created_at: number;
      shared_location: number;
      expected_arrival_at: number;
    };
    return {
      ...row,
      shared_location: !!row.shared_location,
      deliveries: this.db
        .prepare(
          "SELECT contact_name,status,code FROM journey_share_deliveries WHERE share_id=? ORDER BY contact_name",
        )
        .all(shareId) as JourneyShare["deliveries"],
    };
  }

  /**
   * One tap: message the journey's contacts the ETA, route summary and the user's
   * current location. Safe to repeat (each tap sends a fresh update); a retry that
   * reuses the same key returns the first result instead of messaging twice.
   */
  async share(
    userId: string,
    id: string,
    input: unknown,
  ): Promise<JourneyShare> {
    const data = shareSchema.parse(input);
    const previous = this.db
      .prepare(
        "SELECT id FROM journey_shares WHERE user_id=? AND idempotency_key=?",
      )
      .get(userId, data.idempotency_key) as { id: string } | undefined;
    if (previous) return this.shareRecord(userId, previous.id);
    const journey = this.row(userId, id);
    if (!ACTION_ALLOWED["check-in"].includes(journey.status))
      throw new AppError(
        409,
        "INVALID_TRANSITION",
        "Only a journey in progress can be shared.",
      );
    throttle(this.db, userId, "journey-share", 12, this.clock());
    const contactIds = this.sharingContactIds(userId, id);
    if (!contactIds.length)
      throw new AppError(
        409,
        "NO_CONTACTS",
        "None of this journey’s contacts have sharing turned on.",
      );
    const now = this.clock();
    const loc =
      data.location &&
      data.location.captured_at >= now - 300000 &&
      data.location.captured_at <= now + 30000
        ? data.location
        : null;
    const left = Math.max(
      0,
      Math.round((journey.expected_arrival_at - now) / 60000),
    );
    const summary = data.route_summary ? clean(data.route_summary, 240) : "";
    const message =
      `Journey update: heading to "${clean(journey.destination, 80)}"` +
      (journey.origin ? ` from "${clean(journey.origin, 80)}"` : "") +
      `. ETA ${formatTime(journey.expected_arrival_at, journey.time_zone)} (about ${left} min).` +
      (summary ? ` Route: ${summary}.` : "") +
      (loc
        ? ` Live location (${new Intl.DateTimeFormat("en-IN", { timeZone: journey.time_zone ?? "UTC", hour: "numeric", minute: "2-digit" }).format(new Date(loc.captured_at))}): https://maps.google.com/?q=${loc.latitude},${loc.longitude}`
        : " Live location unavailable.") +
      " This message does not alert emergency services.";
    const shareId = randomUUID();
    const names = new Map(
      (
        this.db
          .prepare(
            `SELECT id,name FROM contacts WHERE user_id=? AND id IN (${contactIds.map(() => "?").join(",")})`,
          )
          .all(userId, ...contactIds) as { id: string; name: string }[]
      ).map((c) => [c.id, c.name]),
    );
    this.db
      .prepare(
        "INSERT INTO journey_shares(id,journey_id,user_id,idempotency_key,shared_location,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(shareId, id, userId, data.idempotency_key, +!!loc, now);
    const results = await Promise.all(
      contactIds.map(async (contactId) => ({
        contactId,
        result: await this.emergency.notifyContact(
          userId,
          contactId,
          message,
          `${shareId}:${contactId}`,
        ),
      })),
    );
    this.db.transaction(() => {
      for (const { contactId, result } of results)
        this.db
          .prepare(
            "INSERT OR IGNORE INTO journey_share_deliveries(share_id,contact_id,contact_name,status,code) VALUES(?,?,?,?,?)",
          )
          .run(
            shareId,
            contactId,
            clean(names.get(contactId) ?? "Contact", 80),
            result.status,
            result.code ?? null,
          );
      audit(this.db, userId, "journey.shared", id, this.clock());
    })();
    return this.shareRecord(userId, shareId);
  }

  create(userId: string, input: unknown): Journey {
    const data = createSchema.parse(input);
    return this.db
      .transaction(() => {
        const previous = this.db
          .prepare(
            "SELECT id FROM journeys WHERE user_id=? AND idempotency_key=?",
          )
          .get(userId, data.idempotency_key) as { id: string } | undefined;
        if (previous) return this.get(userId, previous.id);
        this.validateEta(data.expected_arrival_at);
        throttle(this.db, userId, "journeys", 30, this.clock());
        if (
          this.db
            .prepare(
              `SELECT 1 FROM journeys WHERE user_id=? AND status IN (${OPEN_STATUSES.map(() => "?").join(",")})`,
            )
            .get(userId, ...OPEN_STATUSES)
        )
          throw new AppError(
            409,
            "JOURNEY_OPEN",
            "Complete or cancel your open journey before starting another.",
          );
        for (const contactId of data.contact_ids)
          if (
            !this.db
              .prepare(
                "SELECT 1 FROM contacts WHERE id=? AND user_id=? AND alert_enabled=1",
              )
              .get(contactId, userId)
          )
            throw new AppError(
              400,
              "CONTACT_SELECTION",
              "Select only your sharing-enabled contacts.",
            );
        const id = randomUUID();
        const now = this.clock();
        // A stale or future-dated browser location is discarded, not stored.
        const loc =
          data.location &&
          data.location.captured_at >= now - 300000 &&
          data.location.captured_at <= now + 30000
            ? data.location
            : null;
        this.db
          .prepare(
            `INSERT INTO journeys(id,user_id,idempotency_key,status,origin,destination,expected_arrival_at,grace_period_minutes,time_zone,last_known_latitude,last_known_longitude,last_location_accuracy_meters,last_location_updated_at,started_at,created_at,updated_at)
             VALUES(?,?,?,'active',?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            id,
            userId,
            data.idempotency_key,
            data.origin || null,
            data.destination,
            data.expected_arrival_at,
            data.grace_period_minutes,
            data.time_zone ?? null,
            loc?.latitude ?? null,
            loc?.longitude ?? null,
            loc?.accuracy ?? null,
            loc?.captured_at ?? null,
            now,
            now,
            now,
          );
        for (const contactId of data.contact_ids)
          this.db
            .prepare("INSERT INTO journey_contacts VALUES(?,?,?)")
            .run(id, contactId, userId);
        this.event(userId, id, "started");
        return this.get(userId, id);
      })
      .immediate();
  }

  /**
   * User-initiated transition. Every UPDATE re-checks the status it expects, so
   * a concurrent scheduler pass or a second request can never double-apply.
   */
  transition(
    userId: string,
    id: string,
    action: JourneyAction,
    input: unknown,
  ): Journey {
    if (!JOURNEY_ACTIONS.includes(action))
      throw new AppError(404, "NOT_FOUND", "Journey action not found.");
    const data =
      action === "check-in"
        ? checkInSchema.parse(input)
        : action === "extend"
          ? extendSchema.parse(input)
          : emptySchema.parse(input);
    return this.db
      .transaction(() => {
        const journey = this.row(userId, id);
        // Repeating a terminal action is a harmless no-op, not an error.
        if (
          (action === "complete" && journey.status === "completed") ||
          (action === "cancel" && journey.status === "cancelled")
        )
          return this.get(userId, id);
        if (!ACTION_ALLOWED[action].includes(journey.status))
          throw new AppError(
            409,
            "INVALID_TRANSITION",
            "This journey has changed or already ended. Refresh its status.",
          );
        throttle(this.db, userId, "journey-actions", 60, this.clock());
        const now = this.clock();
        const allowed = ACTION_ALLOWED[action];
        const guard = `status IN (${allowed.map(() => "?").join(",")})`;
        if (action === "check-in" || action === "extend") {
          const { expected_arrival_at: eta } = data as {
            expected_arrival_at?: number;
          };
          if (
            action === "check-in" &&
            eta === undefined &&
            journey.status === "check_in_due"
          )
            throw new AppError(
              400,
              "ETA_REQUIRED",
              "Choose a new arrival time to continue your journey.",
            );
          if (eta !== undefined) this.validateEta(eta);
          if (action === "extend" && eta! <= journey.expected_arrival_at)
            throw new AppError(
              400,
              "INVALID_ETA",
              "An extension must be later than the current arrival time.",
            );
          const location = (data as { location?: Location | null }).location;
          const fresh =
            location &&
            location.captured_at >= now - 300000 &&
            location.captured_at <= now + 30000
              ? location
              : null;
          const moved = this.db
            .prepare(
              `UPDATE journeys SET status='active',expected_arrival_at=COALESCE(?,expected_arrival_at),
                 check_in_due_at=NULL,
                 last_check_in_at=CASE WHEN ?='check-in' THEN ? ELSE last_check_in_at END,
                 last_known_latitude=COALESCE(?,last_known_latitude),last_known_longitude=COALESCE(?,last_known_longitude),
                 last_location_accuracy_meters=CASE WHEN ? IS NULL THEN last_location_accuracy_meters ELSE ? END,
                 last_location_updated_at=COALESCE(?,last_location_updated_at),updated_at=?
               WHERE id=? AND user_id=? AND ${guard}`,
            )
            .run(
              eta ?? null,
              action,
              now,
              fresh?.latitude ?? null,
              fresh?.longitude ?? null,
              fresh?.accuracy ?? null,
              fresh?.accuracy ?? null,
              fresh?.captured_at ?? null,
              now,
              id,
              userId,
              ...allowed,
            );
          if (!moved.changes)
            throw new AppError(
              409,
              "INVALID_TRANSITION",
              "This journey has changed or already ended. Refresh its status.",
            );
        } else {
          const column =
            action === "complete" ? "completed_at" : "cancelled_at";
          // The route and coordinates are no longer needed once the trip has ended.
          const moved = this.db
            .prepare(
              `UPDATE journeys SET status=?,${column}=?,updated_at=?,
                 last_known_latitude=NULL,last_known_longitude=NULL,last_location_accuracy_meters=NULL,last_location_updated_at=NULL
               WHERE id=? AND user_id=? AND ${guard}`,
            )
            .run(statusAfter(action), now, now, id, userId, ...allowed);
          if (!moved.changes)
            throw new AppError(
              409,
              "INVALID_TRANSITION",
              "This journey has changed or already ended. Refresh its status.",
            );
          if (journey.status === "escalated")
            this.queueAllClear(userId, journey, action);
        }
        this.event(userId, id, action);
        return this.get(userId, id);
      })
      .immediate();
  }

  /** Contacts were alerted earlier, so tell them the user has now closed the journey. */
  private queueAllClear(
    userId: string,
    journey: JourneyRow,
    action: JourneyAction,
  ) {
    const contactIds = this.sharingContactIds(userId, journey.id);
    if (!contactIds.length) return;
    const destination = clean(journey.destination, 80);
    const message =
      action === "complete"
        ? `Journey Guardian update — the trip to "${destination}" was marked complete by the user. This is their own report, not an independent confirmation.`
        : `Journey Guardian update — the trip to "${destination}" was ended in SAKHI. If you received an alert earlier, please contact them to confirm they are safe. This message does not alert emergency services.`;
    const alert = this.emergency.createQueuedEvent(
      userId,
      `journey-all-clear:${journey.id}`,
      contactIds,
      message,
      "journey_all_clear",
    );
    this.db
      .prepare(
        "UPDATE journeys SET all_clear_alert_id=? WHERE id=? AND user_id=?",
      )
      .run(alert.id, journey.id, userId);
  }

  /** Same as transition(), then makes a best-effort immediate send of any all-clear notice. */
  async transitionAndNotify(
    userId: string,
    id: string,
    action: JourneyAction,
    input: unknown,
  ): Promise<Journey> {
    const journey = this.transition(userId, id, action, input);
    if (journey.all_clear_alert_id) {
      try {
        await this.emergency.dispatchQueued(userId, journey.all_clear_alert_id);
      } catch {
        /* Left queued; the scheduled job retries. */
      }
      return this.get(userId, id);
    }
    return journey;
  }

  /**
   * Scheduler entry point (runs from /api/internal/jobs, not from a browser).
   * Safe to run repeatedly and from overlapping workers: every step is a
   * conditional UPDATE inside its own immediate transaction, escalation uses a
   * per-journey idempotency key, and one journey failing never blocks others.
   */
  processOverdue(): OverdueResult {
    const result: OverdueResult = { checkInDue: 0, escalated: 0, failed: 0 };
    const now = this.clock();
    const due = this.db
      .prepare(
        "SELECT id,user_id FROM journeys WHERE status='active' AND expected_arrival_at<=? ORDER BY expected_arrival_at LIMIT 200",
      )
      .all(now) as { id: string; user_id: string }[];
    for (const j of due) {
      try {
        const changed = this.markCheckInDue(j.user_id, j.id, now);
        if (changed) result.checkInDue++;
      } catch {
        result.failed++;
      }
    }
    const overdue = this.db
      .prepare(
        "SELECT id,user_id FROM journeys WHERE status='check_in_due' AND expected_arrival_at + grace_period_minutes*60000 <= ? ORDER BY expected_arrival_at LIMIT 200",
      )
      .all(now) as { id: string; user_id: string }[];
    for (const j of overdue) {
      try {
        if (this.escalate(j.user_id, j.id, now)) result.escalated++;
      } catch {
        // Rolled back: the journey stays check_in_due and is retried next run.
        result.failed++;
      }
    }
    return result;
  }

  private markCheckInDue(userId: string, id: string, now: number): boolean {
    return this.db
      .transaction(() => {
        const moved = this.db
          .prepare(
            "UPDATE journeys SET status='check_in_due',check_in_due_at=?,updated_at=? WHERE id=? AND user_id=? AND status='active' AND expected_arrival_at<=?",
          )
          .run(now, now, id, userId, now);
        if (moved.changes) this.event(userId, id, "check_in_due");
        return moved.changes > 0;
      })
      .immediate();
  }

  private escalate(userId: string, id: string, now: number): boolean {
    return this.db
      .transaction(() => {
        const moved = this.db
          .prepare(
            "UPDATE journeys SET status='escalated',escalated_at=?,updated_at=? WHERE id=? AND user_id=? AND status='check_in_due' AND expected_arrival_at + grace_period_minutes*60000 <= ?",
          )
          .run(now, now, id, userId, now);
        if (!moved.changes) return false;
        const journey = this.row(userId, id);
        const location: Location | null =
          journey.last_known_latitude !== null &&
          journey.last_known_longitude !== null &&
          journey.last_location_updated_at !== null
            ? {
                latitude: journey.last_known_latitude,
                longitude: journey.last_known_longitude,
                accuracy: journey.last_location_accuracy_meters ?? 0,
                captured_at: journey.last_location_updated_at,
              }
            : null;
        const message = `Journey Guardian alert — no arrival confirmation was received for the trip to "${clean(journey.destination, 80)}" (expected ${formatTime(journey.expected_arrival_at, journey.time_zone)}). Please try to reach them. This message does not alert emergency services.`;
        const alert = this.emergency.createQueuedEvent(
          userId,
          `journey-escalation:${id}`,
          this.sharingContactIds(userId, id),
          message,
          "journey_escalation",
          location,
        );
        this.db
          .prepare("UPDATE journeys SET alert_id=? WHERE id=? AND user_id=?")
          .run(alert.id, id, userId);
        this.event(userId, id, "escalated");
        return true;
      })
      .immediate();
  }
}
