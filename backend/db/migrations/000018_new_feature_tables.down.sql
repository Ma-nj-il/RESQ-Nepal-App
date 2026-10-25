-- =============================================
-- Migration 000018 DOWN: Drop all feature tables
-- Drops in reverse dependency order
-- =============================================

-- PART 14: CHAT
DROP TABLE IF EXISTS chat_quick_replies CASCADE;
DROP TABLE IF EXISTS chat_messages CASCADE;

-- PART 13: WAIT TIME
DROP TABLE IF EXISTS wait_time_notifications CASCADE;
DROP TABLE IF EXISTS wait_time_records CASCADE;
DROP TABLE IF EXISTS wait_time_configs CASCADE;

-- PART 12: PREFERENCES
DROP TABLE IF EXISTS driver_capabilities CASCADE;
DROP TABLE IF EXISTS ride_preference_overrides CASCADE;
DROP TABLE IF EXISTS rider_preferences CASCADE;

-- PART 11: SUBSCRIPTIONS
DROP TABLE IF EXISTS subscription_usage_logs CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS subscription_plans CASCADE;

-- PART 10: GIFT CARDS
DROP TABLE IF EXISTS gift_card_transactions CASCADE;
DROP TABLE IF EXISTS gift_cards CASCADE;

-- PART 9: FAMILY ACCOUNTS
DROP TABLE IF EXISTS family_ride_logs CASCADE;
DROP TABLE IF EXISTS family_invites CASCADE;
DROP TABLE IF EXISTS family_members CASCADE;
DROP TABLE IF EXISTS family_accounts CASCADE;

-- PART 8: PAYMENT METHODS
-- Drop new wallet_transactions and recreate original schema
DROP TABLE IF EXISTS wallet_transactions CASCADE;
DROP TABLE IF EXISTS payment_methods CASCADE;

-- Recreate original wallet_transactions (references wallets table from 000001)
CREATE TABLE wallet_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('credit', 'debit')),
    description TEXT NOT NULL,
    reference_id UUID,
    reference_type VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- PART 7: VEHICLES
DROP TABLE IF EXISTS maintenance_reminders CASCADE;
DROP TABLE IF EXISTS vehicle_inspections CASCADE;
DROP TABLE IF EXISTS vehicles CASCADE;

-- PART 6: DRIVER EARNINGS
DROP TABLE IF EXISTS driver_earning_goals CASCADE;
DROP TABLE IF EXISTS driver_earnings CASCADE;
DROP TABLE IF EXISTS driver_payouts CASCADE;
DROP TABLE IF EXISTS driver_bank_accounts CASCADE;

-- PART 5: RATINGS
DROP TABLE IF EXISTS rating_responses CASCADE;
DROP TABLE IF EXISTS ratings CASCADE;

-- PART 4: TIPS
DROP TABLE IF EXISTS tips CASCADE;

-- PART 3: FARE DISPUTES
DROP TABLE IF EXISTS fare_dispute_comments CASCADE;
DROP TABLE IF EXISTS fare_disputes CASCADE;

-- PART 2: SUPPORT TICKETS
DROP TABLE IF EXISTS faq_articles CASCADE;
DROP TABLE IF EXISTS support_ticket_messages CASCADE;
DROP TABLE IF EXISTS support_tickets CASCADE;

-- PART 1: CANCELLATION
DROP TABLE IF EXISTS cancellation_records CASCADE;
DROP TABLE IF EXISTS cancellation_policies CASCADE;
