import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TriageResult } from "@/lib/triage-types";

// Controlled alert policy. A flagged message can create ONE moderator-queue
// entry; it never reaches the room, never contacts police/ambulance, and never
// carries coordinates. Deduplication and cooldowns stop floods and repeats.
export const POLICY = {
  categories: {
    urgent_safety_concern: {
      priority: "urgent" as const,
      bucketMs: 10 * 60_000,
      perAuthor: true,
    },
    distress: {
      priority: "review" as const,
      bucketMs: 30 * 60_000,
      perAuthor: false,
    },
    harassment_report: {
      priority: "review" as const,
      bucketMs: 30 * 60_000,
      perAuthor: false,
    },
  },
  maxPerAuthorPerHour: 3,
  maxUrgentPerRoomPerHour: 5,
} as const;
type AlertCategory = keyof typeof POLICY.categories;
const isAlertCategory = (c: string): c is AlertCategory =>
  c in POLICY.categories;

export function evaluateAlert(
  db: Database.Database,
  input: {
    roomId: string;
    messageId: string;
    authorId: string;
    triage: TriageResult;
    now: number;
  },
): {
  created: boolean;
  reason:
    "created" | "not_alertable" | "duplicate" | "author_cooldown" | "room_cap";
} {
  const { roomId, messageId, authorId, triage, now } = input;
  if (!isAlertCategory(triage.category) || !triage.needs_review)
    return { created: false, reason: "not_alertable" };
  const rule = POLICY.categories[triage.category];
  const hour = now - 3_600_000;
  const byAuthor = db
    .prepare(
      "SELECT COUNT(*) AS n FROM alert_events WHERE author_id=? AND created_at>?",
    )
    .get(authorId, hour) as { n: number };
  if (byAuthor.n >= POLICY.maxPerAuthorPerHour)
    return { created: false, reason: "author_cooldown" };
  if (rule.priority === "urgent") {
    const urgent = db
      .prepare(
        "SELECT COUNT(*) AS n FROM alert_events WHERE room_id=? AND priority='urgent' AND created_at>?",
      )
      .get(roomId, hour) as { n: number };
    if (urgent.n >= POLICY.maxUrgentPerRoomPerHour)
      return { created: false, reason: "room_cap" };
  }
  const bucket = Math.floor(now / rule.bucketMs);
  const key = `${roomId}:${triage.category}:${rule.perAuthor ? authorId : "*"}:${bucket}`;
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO alert_events(id,room_id,message_id,author_id,category,priority,dedupe_key,status,created_at)
       VALUES(?,?,?,?,?,?,?,'open',?)`,
    )
    .run(
      randomUUID(),
      roomId,
      messageId,
      authorId,
      triage.category,
      rule.priority,
      key,
      now,
    );
  return inserted.changes
    ? { created: true, reason: "created" }
    : { created: false, reason: "duplicate" };
}
