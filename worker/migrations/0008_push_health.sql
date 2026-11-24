-- Delivery tracking for phone notifications: did alerts reach each device while the app was closed?
ALTER TABLE push_subscriptions ADD COLUMN pending_at INTEGER;
ALTER TABLE push_subscriptions ADD COLUMN ack_at INTEGER;
ALTER TABLE push_subscriptions ADD COLUMN health TEXT;
ALTER TABLE push_subscriptions ADD COLUMN health_delay_ms INTEGER;
ALTER TABLE push_subscriptions ADD COLUMN health_at INTEGER;
ALTER TABLE push_subscriptions ADD COLUMN slow_count INTEGER NOT NULL DEFAULT 0;
