import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { AppError } from "./http";
export function audit(
  db: Database.Database,
  userId: string,
  action: string,
  resourceId: string,
  now: number,
) {
  db.prepare("INSERT INTO audit_events VALUES (?, ?, ?, ?, ?)").run(
    randomUUID(),
    userId,
    action,
    resourceId,
    now,
  );
}
export function throttle(
  db: Database.Database,
  userId: string,
  scope: string,
  max: number,
  now: number,
) {
  const start = Math.floor(now / 60000) * 60000;
  const row = db
    .prepare(
      `INSERT INTO request_limits VALUES (?, ?, ?, 1)
    ON CONFLICT(user_id, scope) DO UPDATE SET count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END, window_start = excluded.window_start RETURNING count`,
    )
    .get(userId, scope, start) as { count: number };
  if (row.count > max)
    throw new AppError(
      429,
      "RATE_LIMIT",
      "Too many requests. Wait a minute, or use the emergency call action now.",
    );
}
