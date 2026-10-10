CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  phone_number TEXT NOT NULL CHECK(length(phone_number) BETWEEN 8 AND 16 AND substr(phone_number,1,1) = '+'),
  relationship TEXT CHECK(relationship IS NULL OR length(relationship) <= 60),
  alert_enabled INTEGER NOT NULL DEFAULT 0 CHECK(alert_enabled IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, phone_number),
  UNIQUE(id, user_id)
);
CREATE INDEX contacts_owner ON contacts(user_id, created_at);