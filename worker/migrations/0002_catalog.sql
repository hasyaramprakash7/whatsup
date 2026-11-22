-- Products & services with photos, per business. Photos live in R2; the bot and AI send them on WhatsApp.
CREATE TABLE catalog_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',            -- free text, e.g. "₹1,200" or "from ₹6,000"
  image_url TEXT,                            -- public R2 URL (JPEG/PNG, ≤ 5 MB — WhatsApp's image limit)
  image_key TEXT,                            -- R2 object key, for deleting/replacing
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX catalog_tenant ON catalog_items (tenant_id, active, sort);
