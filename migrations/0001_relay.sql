PRAGMA foreign_keys = ON;

CREATE TABLE calendars (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  slug TEXT NOT NULL UNIQUE CHECK(length(slug) = 12),
  organizer_hash TEXT NOT NULL CHECK(length(organizer_hash) = 64),
  invite_hash TEXT NOT NULL CHECK(length(invite_hash) = 64),
  payload TEXT NOT NULL CHECK(length(payload) <= 8192),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'hidden')),
  report_count INTEGER NOT NULL DEFAULT 0 CHECK(report_count >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX calendars_status_updated_idx ON calendars(status, updated_at);

CREATE TABLE slots (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  slot_date TEXT NOT NULL CHECK(length(slot_date) = 10),
  participant_hash TEXT NOT NULL CHECK(length(participant_hash) = 64),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 40),
  article_title TEXT NOT NULL CHECK(length(article_title) BETWEEN 1 AND 80),
  article_url TEXT NOT NULL DEFAULT '' CHECK(length(article_url) <= 500),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(calendar_id, slot_date)
);

CREATE INDEX slots_calendar_date_idx ON slots(calendar_id, slot_date);

CREATE TABLE calendar_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL CHECK(length(session_id) = 36),
  reporter_hash TEXT NOT NULL CHECK(length(reporter_hash) = 64),
  reason TEXT NOT NULL CHECK(reason IN ('harmful', 'impersonation', 'other', 'spam')),
  created_at INTEGER NOT NULL,
  is_qa INTEGER NOT NULL DEFAULT 0 CHECK(is_qa IN (0, 1)),
  UNIQUE(calendar_id, session_id),
  UNIQUE(calendar_id, reporter_hash)
);

CREATE TABLE product_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK(name IN (
    'visited',
    'calendar_created',
    'calendar_updated',
    'calendar_opened',
    'join_opened',
    'slot_reserved',
    'slot_updated',
    'slot_published',
    'slot_cancelled',
    'slot_released',
    'outbound_opened',
    'calendar_reported',
    'calendar_deleted',
    'returned'
  )),
  session_id TEXT NOT NULL CHECK(length(session_id) = 36),
  calendar_id TEXT CHECK(calendar_id IS NULL OR length(calendar_id) = 36),
  day TEXT NOT NULL CHECK(length(day) = 10),
  created_at INTEGER NOT NULL,
  is_qa INTEGER NOT NULL DEFAULT 0 CHECK(is_qa IN (0, 1))
);

CREATE INDEX product_events_created_idx ON product_events(created_at);
CREATE INDEX product_events_name_day_idx ON product_events(name, day);
CREATE INDEX product_events_calendar_idx ON product_events(calendar_id, name);
