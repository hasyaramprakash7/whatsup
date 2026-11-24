-- WhatsApp agent for any business: core tables.
-- JSON columns hold structured settings (profile, flow, ai, templates) and each lead's collected answers.

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  industry TEXT NOT NULL DEFAULT 'general',
  phone_number_id TEXT NOT NULL UNIQUE,
  waba_id TEXT NOT NULL DEFAULT '',
  access_token_enc TEXT NOT NULL,           -- AES-GCM encrypted with TOKEN_ENCRYPTION_KEY
  api_key_hash TEXT UNIQUE,                 -- sha256 of the vendor's dashboard key
  admin_phone TEXT NOT NULL,                -- team alert number
  tier INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  profile TEXT NOT NULL DEFAULT '{}',       -- about, services, hours, address, location, FAQ, document
  flow TEXT NOT NULL DEFAULT '{}',          -- conversation steps (flow builder)
  ai TEXT NOT NULL DEFAULT '{}',            -- assistant settings
  templates TEXT NOT NULL DEFAULT '{}',     -- Meta template names
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'NEW',       -- NEW, CONTACTED, ENGAGED, QUALIFIED, CONVERTED, COLD
  data TEXT NOT NULL DEFAULT '{}',          -- answers collected by the flow, keyed by field
  booked_at TEXT,                           -- appointment / visit time chosen in a slots step
  last_broadcast_at TEXT,
  last_broadcast_message_id TEXT,
  broadcast_status TEXT,                    -- SENT, DELIVERED, READ, FAILED
  broadcast_status_at TEXT,
  broadcast_error TEXT,
  admin_alert_status TEXT,                  -- SENT, DELIVERED, FAILED
  admin_alert_at TEXT,
  admin_alert_message_id TEXT,
  admin_alert_error TEXT,
  last_message_at TEXT,
  last_message_preview TEXT,
  last_message_direction TEXT,
  last_message_sent_by TEXT,
  last_inbound_at TEXT,                     -- opens WhatsApp's 24h reply window
  unread_count INTEGER NOT NULL DEFAULT 0,
  bot_paused INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tenant_id, phone)
);
CREATE INDEX leads_tenant_status ON leads (tenant_id, status);
CREATE INDEX leads_tenant_last_message ON leads (tenant_id, last_message_at DESC);
CREATE INDEX leads_tenant_broadcast ON leads (tenant_id, last_broadcast_at);
CREATE INDEX leads_broadcast_msg ON leads (tenant_id, last_broadcast_message_id);
CREATE INDEX leads_alert_msg ON leads (tenant_id, admin_alert_message_id);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL,                  -- in | out
  sent_by TEXT NOT NULL,                    -- customer | bot | ai | agent | broadcast
  type TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  meta TEXT,                                -- JSON: buttons, list rows, file, location, template params
  wa_message_id TEXT,
  status TEXT NOT NULL,                     -- received | sent | delivered | read | failed
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX messages_chat ON messages (tenant_id, phone, created_at DESC);
CREATE INDEX messages_wa ON messages (tenant_id, wa_message_id);

-- Daily AI reply counter per business (cost cap).
CREATE TABLE ai_usage (
  tenant_id TEXT NOT NULL,
  day TEXT NOT NULL,
  replies INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, day)
);
