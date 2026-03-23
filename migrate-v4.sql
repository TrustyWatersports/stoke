-- Stoke Migration v4: Gmail integration state
-- Run each statement in D1 console

ALTER TABLE platform_connections ADD COLUMN last_history_id TEXT;
ALTER TABLE platform_connections ADD COLUMN watch_expiry INTEGER;
ALTER TABLE platform_connections ADD COLUMN email TEXT;
