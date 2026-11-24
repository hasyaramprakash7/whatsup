-- Phones and computers that turned on notifications. scope = business id, or '*' for admins (all businesses).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  prefs TEXT NOT NULL DEFAULT '{}',          -- {"message":true,"booking":true,"handoff":true,"broadcast":true}
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  fail_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subscriptions_scope ON push_subscriptions (scope);
