CREATE TABLE places_cache (
 key TEXT PRIMARY KEY,
 category TEXT NOT NULL,
 payload TEXT NOT NULL,
 truncated INTEGER NOT NULL DEFAULT 0 CHECK(truncated IN (0,1)),
 fetched_at INTEGER NOT NULL
);
CREATE INDEX places_cache_age ON places_cache(fetched_at);

CREATE TABLE safe_havens (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 kind TEXT NOT NULL CHECK(length(kind) BETWEEN 1 AND 40),
 latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 address TEXT CHECK(address IS NULL OR length(address) <= 300),
 phone TEXT CHECK(phone IS NULL OR length(phone) <= 40),
 hours TEXT CHECK(hours IS NULL OR length(hours) <= 200),
 status TEXT NOT NULL CHECK(status IN ('pending','verified','suspended')),
 source TEXT NOT NULL CHECK(source IN ('participant','campus','demo')),
 verification_method TEXT CHECK(verification_method IS NULL OR length(verification_method) <= 200),
 verified_at INTEGER,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 CHECK(status != 'verified' OR (verified_at IS NOT NULL AND verification_method IS NOT NULL))
);
CREATE INDEX safe_havens_geo ON safe_havens(status, latitude, longitude);

CREATE TABLE reports (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('incident','infrastructure_hazard')),
 category TEXT NOT NULL CHECK(length(category) BETWEEN 1 AND 60),
 description TEXT CHECK(description IS NULL OR length(description) <= 500),
 latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 area_id TEXT NOT NULL,
 occurred_at INTEGER,
 created_at INTEGER NOT NULL,
 verification TEXT NOT NULL DEFAULT 'unverified' CHECK(verification IN ('unverified','verified')),
 status TEXT NOT NULL DEFAULT 'visible' CHECK(status IN ('visible','hidden')),
 source TEXT NOT NULL CHECK(source IN ('user','synthetic_demo')),
 reporter_id TEXT REFERENCES user(id) ON DELETE SET NULL
);
CREATE INDEX reports_geo ON reports(status, latitude, longitude);
CREATE INDEX reports_area ON reports(area_id, created_at);

CREATE TABLE report_requests (
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 idempotency_key TEXT NOT NULL,
 id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id, idempotency_key)
);
