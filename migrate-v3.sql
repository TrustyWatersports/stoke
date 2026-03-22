-- Stoke Migration v3: Platform Architecture
-- Adds vertical preset support and automation level to settings
-- Run in D1 console: paste each statement

-- Add vertical column to businesses table
ALTER TABLE businesses ADD COLUMN vertical TEXT DEFAULT 'outdoor_service';
ALTER TABLE businesses ADD COLUMN onboarding_complete INTEGER DEFAULT 0;
ALTER TABLE businesses ADD COLUMN automation_level TEXT DEFAULT 'review_all';

-- Vertical presets table - stores the industry knowledge for each vertical
CREATE TABLE IF NOT EXISTS vertical_presets (
  id            TEXT PRIMARY KEY,
  vertical_key  TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  preset_data   TEXT NOT NULL, -- JSON blob
  created_at    INTEGER NOT NULL
);

-- Business presets - customized preset per business (overrides vertical defaults)
CREATE TABLE IF NOT EXISTS business_presets (
  business_id   TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  vertical_key  TEXT NOT NULL,
  preset_data   TEXT NOT NULL, -- JSON blob, merged with vertical preset
  updated_at    INTEGER NOT NULL
);

-- Lead inbox - holds parsed leads before they become calendar events
CREATE TABLE IF NOT EXISTS lead_inbox (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source          TEXT DEFAULT 'email',
  raw_content     TEXT,
  parsed_data     TEXT, -- JSON: extracted lead fields
  status          TEXT DEFAULT 'pending', -- pending | confirmed | dismissed
  confidence      REAL DEFAULT 0,
  event_id        TEXT, -- set when confirmed to calendar
  received_at     INTEGER NOT NULL,
  reviewed_at     INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lead_inbox_business ON lead_inbox(business_id, status, received_at DESC);

-- Automation log - audit trail of everything Stoke did automatically
CREATE TABLE IF NOT EXISTS automation_log (
  id            TEXT PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  action_type   TEXT NOT NULL, -- email_parsed | event_created | reply_sent | invoice_sent
  description   TEXT,
  data          TEXT, -- JSON context
  agent         TEXT, -- which agent performed this
  confidence    REAL,
  status        TEXT DEFAULT 'completed', -- completed | pending_review | failed
  reviewed_by   TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automation_log_business ON automation_log(business_id, created_at DESC);
