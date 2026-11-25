-- Bulk sending: every broadcast is a campaign; each number in it is a recipient row with its own status.
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_name TEXT NOT NULL,
  template_lang TEXT NOT NULL,
  template_category TEXT,                  -- MARKETING | UTILITY (for the cost estimate)
  params TEXT NOT NULL DEFAULT '[]',       -- JSON: what fills {{1}}, {{2}}… (name, business, project, column:x, text:y)
  header TEXT,                             -- JSON: { type: 'image', source: 'project' | url } when the template has a photo header
  item_id TEXT,                            -- the project / product the campaign is about (replies go straight to it)
  telugu INTEGER NOT NULL DEFAULT 0,       -- Telugu customers get the "te" version of the template
  status TEXT NOT NULL,                    -- scheduled | sending | waiting_limit | waiting_hours | paused | done | cancelled
  paused_reason TEXT,
  start_at TEXT NOT NULL,
  cost_each REAL NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS campaigns_tenant ON campaigns (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS campaigns_active ON campaigns (tenant_id, status);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  vars TEXT,                               -- JSON: the CSV row (project_name, …)
  status TEXT NOT NULL DEFAULT 'waiting',  -- waiting | sent | delivered | read | failed | capped | invalid | skipped | cancelled
  wa_message_id TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at TEXT,                            -- not before this time (retry / Meta's 24-hour per-person cap)
  counted INTEGER NOT NULL DEFAULT 1,      -- 0 = the customer had written in the last 24 h, so Meta's daily limit didn't count it
  sent_at TEXT,
  replied_at TEXT,
  PRIMARY KEY (campaign_id, phone)
);
CREATE INDEX IF NOT EXISTS campaign_recipients_due ON campaign_recipients (campaign_id, status, next_at);
CREATE INDEX IF NOT EXISTS campaign_recipients_wa ON campaign_recipients (tenant_id, wa_message_id);
CREATE INDEX IF NOT EXISTS campaign_recipients_sent ON campaign_recipients (tenant_id, sent_at);
CREATE INDEX IF NOT EXISTS campaign_recipients_phone ON campaign_recipients (tenant_id, phone, sent_at);

-- Per business: daily limit (auto from Meta, or a number typed in), sending hours, price per message.
ALTER TABLE tenants ADD COLUMN sending TEXT;
-- Per customer: last campaign (replies go to its project), "not on WhatsApp", Meta's 24-hour marketing cap.
ALTER TABLE leads ADD COLUMN campaign_id TEXT;
ALTER TABLE leads ADD COLUMN reach_status TEXT;
ALTER TABLE leads ADD COLUMN capped_until TEXT;
