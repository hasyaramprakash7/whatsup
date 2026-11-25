-- AI setup helper: daily step count (keeps the free AI allowance for the bot) and requests from businesses that
-- connected their own Meta account (an admin approves them; the access token is stored encrypted).
CREATE TABLE IF NOT EXISTS helper_usage (
  day TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  steps INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, tenant_id)
);

CREATE TABLE IF NOT EXISTS onboarding_requests (
  id TEXT PRIMARY KEY,
  from_tenant_id TEXT,
  business_name TEXT NOT NULL,
  industry TEXT,
  waba_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  app_secret_enc TEXT,
  admin_phone TEXT,
  display_phone TEXT,
  verified_name TEXT,
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting | approved | rejected
  created_tenant_id TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_onboarding_status ON onboarding_requests (status, created_at);

-- A business that uses its own Meta app: Meta signs its webhooks with that app's secret (stored encrypted).
ALTER TABLE tenants ADD COLUMN app_secret_enc TEXT;
