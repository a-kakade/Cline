import type Database from "better-sqlite3";

export type MonitorState = "ok" | "stale" | "never";
export type MonitorStatus = { state: MonitorState; last_run_at: number | null };
export const MONITOR_MAX_AGE_MS = 3 * 60_000;

// The scheduler records a heartbeat each time the protected job completes, so the
// UI can state whether automatic journey escalation is really being driven.
export function recordHeartbeat(
  db: Database.Database,
  name: string,
  now = Date.now(),
) {
  db.prepare(
    "INSERT INTO job_heartbeats(name,last_run_at) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET last_run_at=excluded.last_run_at",
  ).run(name, now);
}
export function monitorStatus(
  db: Database.Database,
  name: string,
  now = Date.now(),
): MonitorStatus {
  const row = db
    .prepare("SELECT last_run_at FROM job_heartbeats WHERE name=?")
    .get(name) as { last_run_at: number } | undefined;
  if (!row) return { state: "never", last_run_at: null };
  return {
    state: now - row.last_run_at <= MONITOR_MAX_AGE_MS ? "ok" : "stale",
    last_run_at: row.last_run_at,
  };
}
