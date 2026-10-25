-- Negotiation System Migration Rollback
-- Reverses all changes from 000013_negotiation_system.up.sql

-- ========================================
-- DROP TRIGGERS
-- ========================================

DROP TRIGGER IF EXISTS update_negotiation_settings_updated_at ON negotiation_settings;
DROP TRIGGER IF EXISTS update_driver_pricing_stats_updated_at ON driver_pricing_stats;
DROP TRIGGER IF EXISTS update_negotiation_sessions_updated_at ON negotiation_sessions;

-- ========================================
-- DROP TABLES (reverse order of creation)
-- ========================================

DROP TABLE IF EXISTS negotiation_participants;
DROP TABLE IF EXISTS negotiation_audit_logs;
DROP TABLE IF EXISTS negotiation_settings;
DROP TABLE IF EXISTS route_price_history;
DROP TABLE IF EXISTS driver_pricing_stats;
DROP TABLE IF EXISTS negotiation_offers;
DROP TABLE IF EXISTS negotiation_sessions;
