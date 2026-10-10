-- Roles are granted only by an operator script, never through the HTTP API.
CREATE TABLE user_roles (
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('moderator')),
 granted_at INTEGER NOT NULL,
 PRIMARY KEY(user_id, role)
);

-- An area room's id is its grid-cell id (src/lib/geo.ts), so assignment is
-- deterministic and no room is ever centred on a person.
CREATE TABLE rooms (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 3 AND 40),
 kind TEXT NOT NULL CHECK(kind IN ('area','venue')),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 center_lat REAL NOT NULL CHECK(center_lat BETWEEN -90 AND 90),
 center_lon REAL NOT NULL CHECK(center_lon BETWEEN -180 AND 180),
 radius_m INTEGER NOT NULL CHECK(radius_m BETWEEN 50 AND 20000),
 created_at INTEGER NOT NULL
);

CREATE TABLE room_members (
 room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 joined_at INTEGER NOT NULL,
 muted INTEGER NOT NULL DEFAULT 0 CHECK(muted IN (0,1)),
 PRIMARY KEY(room_id, user_id)
);
CREATE INDEX room_members_user ON room_members(user_id, joined_at);

CREATE TABLE room_bans (
 room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 banned_by TEXT REFERENCES user(id) ON DELETE SET NULL,
 reason TEXT CHECK(reason IS NULL OR length(reason) <= 200),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(room_id, user_id)
);

CREATE TABLE messages (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 client_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 500),
 status TEXT NOT NULL DEFAULT 'visible' CHECK(status IN ('visible','hidden')),
 created_at INTEGER NOT NULL,
 UNIQUE(user_id, client_id)
);
CREATE INDEX messages_room ON messages(room_id, seq);
CREATE INDEX messages_retention ON messages(created_at);

CREATE TABLE message_reports (
 id TEXT PRIMARY KEY,
 message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 reporter_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 reason TEXT NOT NULL CHECK(reason IN ('abuse','spam','unsafe_info','privacy','other')),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','actioned','dismissed')),
 created_at INTEGER NOT NULL,
 UNIQUE(message_id, reporter_id)
);
CREATE INDEX message_reports_open ON message_reports(status, created_at);

CREATE TABLE user_blocks (
 blocker_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 blocked_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(blocker_id, blocked_id),
 CHECK(blocker_id != blocked_id)
);

-- One rating per user per area; a user can rate the area overall and,
-- optionally, how it felt by day and by night.
CREATE TABLE ratings (
 id TEXT PRIMARY KEY,
 area_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
 day_stars INTEGER CHECK(day_stars IS NULL OR day_stars BETWEEN 1 AND 5),
 night_stars INTEGER CHECK(night_stars IS NULL OR night_stars BETWEEN 1 AND 5),
 review TEXT CHECK(review IS NULL OR length(review) BETWEEN 1 AND 280),
 status TEXT NOT NULL DEFAULT 'visible' CHECK(status IN ('visible','hidden')),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(area_id, user_id)
);
CREATE INDEX ratings_area ON ratings(area_id, status, updated_at);

CREATE TABLE rating_reports (
 rating_id TEXT NOT NULL REFERENCES ratings(id) ON DELETE CASCADE,
 reporter_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 reason TEXT NOT NULL CHECK(reason IN ('abuse','spam','privacy','other')),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','actioned','dismissed')),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(rating_id, reporter_id)
);

-- Safety triage of a message. `strength` describes how strongly the rules (or a
-- model) matched; it is NOT a probability that someone is in danger.
CREATE TABLE triage_results (
 message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
 category TEXT NOT NULL CHECK(category IN ('general','concern','harassment_report','infrastructure_hazard','distress','urgent_safety_concern','unknown')),
 language TEXT NOT NULL CHECK(length(language) BETWEEN 2 AND 12),
 strength TEXT NOT NULL CHECK(strength IN ('none','weak','moderate','strong')),
 reason TEXT NOT NULL CHECK(length(reason) <= 200),
 needs_review INTEGER NOT NULL CHECK(needs_review IN (0,1)),
 method TEXT NOT NULL CHECK(method IN ('rules','model')),
 created_at INTEGER NOT NULL
);

-- Alerts go to moderators only; they never contain coordinates and are never
-- sent to the room or to emergency services.
CREATE TABLE alert_events (
 id TEXT PRIMARY KEY,
 room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 author_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 category TEXT NOT NULL CHECK(category IN ('harassment_report','distress','urgent_safety_concern')),
 priority TEXT NOT NULL CHECK(priority IN ('review','urgent')),
 dedupe_key TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','dismissed')),
 created_at INTEGER NOT NULL,
 handled_by TEXT REFERENCES user(id) ON DELETE SET NULL,
 handled_at INTEGER
);
CREATE INDEX alert_events_open ON alert_events(status, created_at);
CREATE INDEX alert_events_author ON alert_events(author_id, created_at);
