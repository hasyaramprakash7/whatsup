-- Team & security (one key per person, 2-step sign-in, activity log) and monitoring.
-- The app also creates these on first use (CREATE IF NOT EXISTS), so the order of deploys doesn't matter.
CREATE TABLE IF NOT EXISTS team_members (id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT NOT NULL, role TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE, totp_enc TEXT, totp_pending_enc TEXT, totp_on INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, created_by TEXT, last_used_at TEXT, revoked_at TEXT);
CREATE INDEX IF NOT EXISTS team_members_tenant ON team_members (tenant_id);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS audit_log_tenant_at ON audit_log (tenant_id, at);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT, kind TEXT NOT NULL, detail TEXT, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_kind_at ON events (kind, at);
CREATE TABLE IF NOT EXISTS monitor_alerts (key TEXT PRIMARY KEY, last_at TEXT NOT NULL, detail TEXT);
