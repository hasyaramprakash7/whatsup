-- Each product/service belongs to one layout (flow template), e.g. a business's real estate
-- products are separate from its salon products. Existing items go to the business's current layout.
ALTER TABLE catalog_items ADD COLUMN layout TEXT NOT NULL DEFAULT 'general';
UPDATE catalog_items SET layout = COALESCE((SELECT industry FROM tenants WHERE tenants.id = catalog_items.tenant_id), 'general');
CREATE INDEX catalog_layout ON catalog_items (tenant_id, layout, active, sort);
