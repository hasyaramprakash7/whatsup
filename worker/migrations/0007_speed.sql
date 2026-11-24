-- Leads and Confirmed lists sort by "last updated" for one business: index it so they stay instant as leads grow.
CREATE INDEX IF NOT EXISTS leads_tenant_updated ON leads (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS leads_tenant_status_updated ON leads (tenant_id, status, updated_at DESC);
-- Daily broadcast quota counts recent sends per business.
CREATE INDEX IF NOT EXISTS leads_tenant_broadcast_at ON leads (tenant_id, last_broadcast_at DESC);
