ALTER TABLE journeys ADD COLUMN check_in_due_at INTEGER;
ALTER TABLE journeys ADD COLUMN last_check_in_at INTEGER;
ALTER TABLE journeys ADD COLUMN time_zone TEXT CHECK(time_zone IS NULL OR length(time_zone) BETWEEN 1 AND 64);
ALTER TABLE journeys ADD COLUMN all_clear_alert_id TEXT REFERENCES alerts(id) ON DELETE SET NULL;
CREATE INDEX journey_terminal_retention ON journeys(status,updated_at);
ALTER TABLE alerts ADD COLUMN kind TEXT NOT NULL DEFAULT 'sos' CHECK(kind IN ('sos','journey_escalation','journey_all_clear'));
CREATE TABLE job_heartbeats (
 name TEXT PRIMARY KEY CHECK(length(name) BETWEEN 1 AND 40),
 last_run_at INTEGER NOT NULL
);
