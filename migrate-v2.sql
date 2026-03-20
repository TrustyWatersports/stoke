-- ============================================================
-- Stoke D1 Migration v2 — Events, Quotes, Leads
-- Run via: npx wrangler d1 execute stoke-db --file=migrate-v2.sql --remote
-- ============================================================

-- ── EVENTS (unified calendar) ─────────────────────────────────
-- All calendar entries live here — jobs, rentals, lessons, 
-- social posts, and blocked time all in one table.
CREATE TABLE IF NOT EXISTS events (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,     -- rental | rigging | lesson | social | blocked | other
  title           TEXT NOT NULL,
  start_at        INTEGER NOT NULL,  -- Unix timestamp
  end_at          INTEGER NOT NULL,  -- Unix timestamp
  all_day         INTEGER DEFAULT 0, -- 0 | 1
  color           TEXT,              -- override hex color
  status          TEXT DEFAULT 'confirmed', -- confirmed | tentative | cancelled

  -- Customer info (for bookings)
  customer_name   TEXT,
  customer_email  TEXT,
  customer_phone  TEXT,
  notes           TEXT,

  -- Cross-references
  job_id          TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  post_id         TEXT REFERENCES posts(id) ON DELETE SET NULL,
  lead_id         TEXT,              -- FK to leads.id (added below)

  -- AI metadata
  ai_suggested    INTEGER DEFAULT 0, -- 1 if AI created this draft
  ai_confidence   REAL,              -- 0..1 confidence score
  ai_notes        TEXT,              -- AI reasoning / extraction notes

  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_business ON events(business_id);
CREATE INDEX IF NOT EXISTS idx_events_range    ON events(business_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_events_type     ON events(business_id, type);
CREATE INDEX IF NOT EXISTS idx_events_status   ON events(business_id, status);

-- ── LEADS ──────────────────────────────────────────────────────
-- Inbound inquiries from any source: email, web form, phone
CREATE TABLE IF NOT EXISTS leads (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source          TEXT DEFAULT 'email', -- email | form | phone | walk_in | social
  status          TEXT DEFAULT 'new',   -- new | contacted | quoted | won | lost

  -- Contact
  customer_name   TEXT,
  customer_email  TEXT,
  customer_phone  TEXT,

  -- Request details
  service_type    TEXT,  -- rental | rigging | lesson | sailboat | repair | other
  message         TEXT,  -- raw message / notes
  preferred_dates TEXT,  -- freetext or JSON

  -- AI extraction
  ai_extracted    TEXT,  -- JSON: {service_type, duration_hours, preferred_dates, urgency, notes}
  ai_summary      TEXT,  -- one-line AI summary of the lead

  -- References
  inbox_message_id TEXT REFERENCES inbox_messages(id) ON DELETE SET NULL,
  event_id        TEXT,  -- the calendar event created from this lead
  job_id          TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  quote_id        TEXT,  -- FK to quotes.id (added below)

  received_at     INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_business ON leads(business_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status   ON leads(business_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_source   ON leads(business_id, source);

-- ── QUOTES ────────────────────────────────────────────────────
-- AI-generated quotes attached to leads/jobs
CREATE TABLE IF NOT EXISTS quotes (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lead_id         TEXT REFERENCES leads(id) ON DELETE SET NULL,
  job_id          TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  status          TEXT DEFAULT 'draft', -- draft | sent | accepted | declined | expired

  -- Customer
  customer_name   TEXT,
  customer_email  TEXT,

  -- Quote content
  service_type    TEXT,
  description     TEXT,
  line_items      TEXT NOT NULL DEFAULT '[]', -- JSON: [{desc, qty, unit_price, total}]
  subtotal        REAL DEFAULT 0,
  tax_rate        REAL DEFAULT 0,
  tax_amount      REAL DEFAULT 0,
  total           REAL DEFAULT 0,
  valid_until     INTEGER,  -- Unix timestamp

  -- AI generation
  ai_generated    INTEGER DEFAULT 0,
  ai_notes        TEXT,

  -- Delivery
  sent_at         INTEGER,
  accepted_at     INTEGER,
  declined_at     INTEGER,
  accept_token    TEXT UNIQUE, -- secure token for customer accept link

  -- Billing integration
  quickbooks_id   TEXT,
  stripe_link     TEXT,

  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quotes_business ON quotes(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_status   ON quotes(business_id, status);
CREATE INDEX IF NOT EXISTS idx_quotes_token    ON quotes(accept_token);

-- ── SERVICE TYPES lookup (for Trusty Sail) ────────────────────
-- Defines duration, color, and pricing hints per service type
CREATE TABLE IF NOT EXISTS service_types (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,        -- "Kayak Rental", "Custom Rigging Build"
  type_key        TEXT NOT NULL,        -- rental | rigging | lesson | sailboat | repair
  color           TEXT NOT NULL,        -- hex color for calendar
  default_duration_minutes INTEGER DEFAULT 120,
  base_price      REAL,
  price_unit      TEXT DEFAULT 'flat',  -- flat | hour | day | person
  active          INTEGER DEFAULT 1,
  UNIQUE(business_id, type_key, name)
);

-- ── Seed Trusty Sail service types ────────────────────────────
INSERT OR IGNORE INTO service_types 
  (id, business_id, name, type_key, color, default_duration_minutes, base_price, price_unit)
VALUES
  ('svc_kayak_rental',   'biz_trustysail', 'Kayak Rental',           'rental',   '#2196F3', 120,  45,   'hour'),
  ('svc_sail_rental',    'biz_trustysail', 'Sailboat Rental',        'rental',   '#1565C0', 240,  120,  'hour'),
  ('svc_tour',           'biz_trustysail', 'Guided Tour',            'rental',   '#42A5F5', 180,  75,   'person'),
  ('svc_rigging',        'biz_trustysail', 'Custom Rigging Build',   'rigging',  '#FF6D00', 480,  250,  'flat'),
  ('svc_repair',         'biz_trustysail', 'Kayak Repair',           'rigging',  '#E65100', 180,  95,   'hour'),
  ('svc_kayak_lesson',   'biz_trustysail', 'Kayak Lesson',           'lesson',   '#2E7D32', 90,   65,   'person'),
  ('svc_sail_lesson',    'biz_trustysail', 'Sailing Lesson',         'lesson',   '#1B5E20', 120,  85,   'person'),
  ('svc_sail_demo',      'biz_trustysail', 'Sailboat Demo',          'sailboat', '#6A1B9A', 120,  0,    'flat'),
  ('svc_blocked',        'biz_trustysail', 'Blocked Time',           'blocked',  '#616161', 60,   0,    'flat');

-- ── STAFF ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  color           TEXT DEFAULT '#888', -- calendar color for this person
  active          INTEGER DEFAULT 1,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_business ON staff(business_id);

INSERT OR IGNORE INTO staff (id, business_id, name, color, active, created_at)
VALUES 
  ('stf_andrew',  'biz_trustysail', 'Andrew', '#1a6b4a', 1, strftime('%s','now')),
  ('stf_heather', 'biz_trustysail', 'Heather', '#E1306C', 1, strftime('%s','now'));

-- ── EVENT_STAFF junction ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_staff (
  event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  staff_id  TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  PRIMARY KEY(event_id, staff_id)
);
