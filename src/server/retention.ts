import type Database from "better-sqlite3";
export function applyRetention(db: Database.Database, now = Date.now()) {
  return db.transaction(() => {
    const locations = db
      .prepare(
        "UPDATE alerts SET latitude=NULL,longitude=NULL,location_accuracy_meters=NULL,location_captured_at=NULL WHERE location_captured_at<?",
      )
      .run(now - 86400000).changes;
    const alerts = db
      .prepare(
        "DELETE FROM alerts WHERE created_at<? AND status NOT IN ('created','queued','sending')",
      )
      .run(now - 30 * 86400000).changes;
    const audits = db
      .prepare("DELETE FROM audit_events WHERE created_at<?")
      .run(now - 90 * 86400000).changes;
    db.prepare("DELETE FROM request_limits WHERE window_start<?").run(
      now - 86400000,
    );
    return { locations, alerts, audits };
  })();
}
