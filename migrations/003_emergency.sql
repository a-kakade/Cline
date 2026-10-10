CREATE TABLE alerts (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 idempotency_key TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('created','queued','sending','accepted','delivered','failed','unknown','simulated','partial')),
 reason TEXT, latitude REAL CHECK(latitude BETWEEN -90 AND 90), longitude REAL CHECK(longitude BETWEEN -180 AND 180),
 location_accuracy_meters REAL CHECK(location_accuracy_meters >= 0), location_captured_at INTEGER,
 message TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(user_id,idempotency_key), CHECK((latitude IS NULL) = (longitude IS NULL))
);
CREATE INDEX alerts_owner ON alerts(user_id,created_at);
CREATE TABLE deliveries (
 id TEXT PRIMARY KEY, alert_id TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
 contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','sending','accepted','delivered','failed','unknown','simulated')),
 code TEXT, attempt_count INTEGER NOT NULL DEFAULT 0, retryable INTEGER NOT NULL DEFAULT 0 CHECK(retryable IN(0,1)),
 next_attempt_at INTEGER NOT NULL, provider_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(alert_id,contact_id)
);
CREATE INDEX delivery_pending ON deliveries(status,next_attempt_at);
CREATE TABLE delivery_attempts (
 id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
 attempt_number INTEGER NOT NULL, status TEXT NOT NULL, code TEXT, started_at INTEGER NOT NULL, finished_at INTEGER,
 UNIQUE(delivery_id,attempt_number)
);