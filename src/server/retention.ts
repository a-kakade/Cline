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
    // Journeys: coordinates are dropped when a journey ends (and defensively
    // here); finished journeys are deleted after 30 days.
    const journeyLocations = db
      .prepare(
        "UPDATE journeys SET last_known_latitude=NULL,last_known_longitude=NULL,last_location_accuracy_meters=NULL,last_location_updated_at=NULL WHERE status IN ('completed','cancelled') AND last_known_latitude IS NOT NULL",
      )
      .run().changes;
    const journeys = db
      .prepare(
        "DELETE FROM journeys WHERE status IN ('completed','cancelled') AND updated_at<?",
      )
      .run(now - 30 * 86400000).changes;
    // Map data: cached provider responses older than the stale limit are useless;
    // user reports are kept for two years.
    const placesCache = db
      .prepare("DELETE FROM places_cache WHERE fetched_at<?")
      .run(now - 7 * 86400000).changes;
    const oldReports = db
      .prepare("DELETE FROM reports WHERE source='user' AND created_at<?")
      .run(now - 730 * 86400000).changes;
    // Area-room messages (with their triage rows, reports and alerts via cascade).
    const messages = db
      .prepare("DELETE FROM messages WHERE created_at<?")
      .run(now - 30 * 86400000).changes;
    const audits = db
      .prepare("DELETE FROM audit_events WHERE created_at<?")
      .run(now - 90 * 86400000).changes;
    db.prepare("DELETE FROM request_limits WHERE window_start<?").run(
      now - 86400000,
    );
    return {
      locations,
      alerts,
      audits,
      journeyLocations,
      journeys,
      placesCache,
      oldReports,
      messages,
    };
  })();
}
