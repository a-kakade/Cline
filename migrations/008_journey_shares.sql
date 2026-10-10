-- One-tap "share my journey" sends. Coordinates are deliberately NOT stored here: the
-- location goes only into the message sent to contacts, and nothing is kept afterwards.
CREATE TABLE journey_shares (
 id TEXT PRIMARY KEY,
 journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 idempotency_key TEXT NOT NULL,
 shared_location INTEGER NOT NULL CHECK(shared_location IN (0,1)),
 created_at INTEGER NOT NULL,
 UNIQUE(user_id, idempotency_key)
);
CREATE INDEX journey_shares_journey ON journey_shares(journey_id, created_at);
CREATE TABLE journey_share_deliveries (
 share_id TEXT NOT NULL REFERENCES journey_shares(id) ON DELETE CASCADE,
 contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
 contact_name TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('accepted','delivered','failed','unknown','simulated')),
 code TEXT,
 PRIMARY KEY(share_id, contact_name)
);
