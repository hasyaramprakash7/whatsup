-- Extra product details that depend on the business type, e.g. {"config":"3 BHK","area":"1,850 sq.ft"}.
-- The fields for each layout are defined in src/lib/itemfields.js.
ALTER TABLE catalog_items ADD COLUMN details TEXT NOT NULL DEFAULT '{}';
