-- ============================================================
-- Stoke D1 Database Schema v1.0
-- Run via: wrangler d1 execute stoke-db --file=schema.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS businesses (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  city        TEXT, area TEXT, website TEXT, phone TEXT,
  plan        TEXT DEFAULT 'trial',
  created_at  INTEGER NOT NULL,
  trial_ends  INTEGER
);

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT,
  role         TEXT DEFAULT 'owner',
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_business ON users(business_id);
CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  token        TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id  TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS magic_links (
  token       TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used        INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  business_id  TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  data         TEXT NOT NULL DEFAULT '{}',
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  job_type        TEXT, customer_moment TEXT, products_used TEXT,
  problem_solved  TEXT, extra_details TEXT,
  tone            TEXT DEFAULT 'general',
  days            INTEGER DEFAULT 3,
  start_date      TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaigns_business ON campaigns(business_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_created  ON campaigns(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS posts (
  id            TEXT PRIMARY KEY,
  campaign_id   TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  business_id   TEXT NOT NULL,
  channel       TEXT NOT NULL,
  day_num       INTEGER NOT NULL,
  angle         TEXT, content TEXT NOT NULL,
  status        TEXT DEFAULT 'draft',
  scheduled_at  INTEGER,
  published_at  INTEGER,
  photo_id      TEXT,
  error_msg     TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_campaign  ON posts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled ON posts(status, scheduled_at) WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS photos (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  campaign_id  TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  r2_key       TEXT NOT NULL,
  label        TEXT, original_name TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_campaign ON photos(campaign_id);

CREATE TABLE IF NOT EXISTS inbox_messages (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  from_email   TEXT, from_name TEXT, subject TEXT, body TEXT,
  received_at  INTEGER NOT NULL,
  category     TEXT,
  status       TEXT DEFAULT 'unread',
  draft_reply  TEXT, replied_at INTEGER, gmail_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_inbox_business ON inbox_messages(business_id, received_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_name   TEXT, customer_email TEXT, customer_phone TEXT,
  description     TEXT,
  status          TEXT DEFAULT 'inquiry',
  quoted_amount   REAL, notes TEXT,
  created_at      INTEGER NOT NULL,
  scheduled_at    INTEGER, completed_at INTEGER,
  inbox_message_id TEXT REFERENCES inbox_messages(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_business ON jobs(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS invoices (
  id             TEXT PRIMARY KEY,
  business_id    TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  job_id         TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  amount         REAL NOT NULL, line_items TEXT,
  status         TEXT DEFAULT 'draft',
  sent_at INTEGER, due_at INTEGER, paid_at INTEGER,
  quickbooks_id  TEXT, follow_up_sent INTEGER DEFAULT 0,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_business ON invoices(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_connections (
  id            TEXT PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,
  access_token  TEXT, refresh_token TEXT,
  page_id TEXT, page_name TEXT,
  expires_at    INTEGER,
  status        TEXT DEFAULT 'active',
  created_at    INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(business_id, platform)
);
