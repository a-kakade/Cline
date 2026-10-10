CREATE TABLE journeys (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 idempotency_key TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','check_in_due','completed','cancelled','escalated')),
 origin TEXT, destination TEXT NOT NULL CHECK(length(trim(destination)) BETWEEN 1 AND 200),
 expected_arrival_at INTEGER NOT NULL, grace_period_minutes INTEGER NOT NULL CHECK(grace_period_minutes BETWEEN 1 AND 60),
 last_known_latitude REAL CHECK(last_known_latitude BETWEEN -90 AND 90), last_known_longitude REAL CHECK(last_known_longitude BETWEEN -180 AND 180),
 last_location_accuracy_meters REAL CHECK(last_location_accuracy_meters>=0), last_location_updated_at INTEGER,
 started_at INTEGER NOT NULL, completed_at INTEGER, cancelled_at INTEGER, escalated_at INTEGER,
 alert_id TEXT REFERENCES alerts(id) ON DELETE SET NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(user_id,idempotency_key), UNIQUE(id,user_id),
 CHECK((last_known_latitude IS NULL) = (last_known_longitude IS NULL)),
 CHECK(expected_arrival_at>started_at)
);
CREATE UNIQUE INDEX journey_one_open ON journeys(user_id) WHERE status IN ('active','check_in_due','escalated');
CREATE INDEX journey_owner ON journeys(user_id,created_at);
CREATE INDEX journey_deadline ON journeys(status,expected_arrival_at);
CREATE TABLE journey_contacts (
 journey_id TEXT NOT NULL, contact_id TEXT NOT NULL, user_id TEXT NOT NULL,
 PRIMARY KEY(journey_id,contact_id),
 FOREIGN KEY(journey_id,user_id) REFERENCES journeys(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(contact_id,user_id) REFERENCES contacts(id,user_id) ON DELETE CASCADE
);
CREATE TABLE journey_events (
 id TEXT PRIMARY KEY, journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('started','check_in_due','check-in','extend','complete','cancel','escalated')),
 created_at INTEGER NOT NULL
);
CREATE INDEX journey_event_time ON journey_events(journey_id,created_at);