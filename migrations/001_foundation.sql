CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_owner ON audit_events(user_id, created_at);
CREATE TABLE request_limits (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(user_id, scope)
);