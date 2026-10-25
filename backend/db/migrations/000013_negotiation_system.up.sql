-- Negotiation System Migration
-- Enables real-time price negotiation between riders and drivers

-- ========================================
-- NEGOTIATION SESSIONS
-- ========================================

CREATE TABLE negotiation_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES users(id),

    -- Ride details
    pickup_latitude DECIMAL(10,8) NOT NULL,
    pickup_longitude DECIMAL(11,8) NOT NULL,
    pickup_address TEXT NOT NULL,
    dropoff_latitude DECIMAL(10,8) NOT NULL,
    dropoff_longitude DECIMAL(11,8) NOT NULL,
    dropoff_address TEXT NOT NULL,

    -- Location context
    country_id UUID REFERENCES countries(id),
    region_id UUID REFERENCES regions(id),
    city_id UUID REFERENCES cities(id),
    pickup_zone_id UUID REFERENCES pricing_zones(id),
    dropoff_zone_id UUID REFERENCES pricing_zones(id),

    -- Pricing context
    ride_type_id UUID REFERENCES ride_types(id),
    currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
    estimated_distance DECIMAL(10,2) NOT NULL,
    estimated_duration INTEGER NOT NULL,
    estimated_fare DECIMAL(10,2) NOT NULL,

    -- Fair price bounds (calculated by system)
    fair_price_min DECIMAL(10,2) NOT NULL,
    fair_price_max DECIMAL(10,2) NOT NULL,
    system_suggested_price DECIMAL(10,2) NOT NULL,

    -- Rider's initial offer (optional)
    rider_initial_offer DECIMAL(10,2),

    -- Session state
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    accepted_offer_id UUID,
    accepted_driver_id UUID REFERENCES drivers(id),
    accepted_price DECIMAL(10,2),

    -- Timing
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,

    CONSTRAINT chk_session_status CHECK (status IN (
        'active',        -- Session is open for offers
        'accepted',      -- Offer accepted, ride being created
        'completed',     -- Ride created successfully
        'expired',       -- Session timed out
        'cancelled',     -- Rider cancelled
        'no_drivers'     -- No drivers made offers
    ))
);

CREATE INDEX idx_negotiation_sessions_rider ON negotiation_sessions(rider_id);
CREATE INDEX idx_negotiation_sessions_status ON negotiation_sessions(status) WHERE status = 'active';
CREATE INDEX idx_negotiation_sessions_expires ON negotiation_sessions(expires_at) WHERE status = 'active';
CREATE INDEX idx_negotiation_sessions_location ON negotiation_sessions(city_id, status) WHERE status = 'active';
CREATE INDEX idx_negotiation_sessions_created ON negotiation_sessions(created_at DESC);

-- ========================================
-- NEGOTIATION OFFERS
-- ========================================

CREATE TABLE negotiation_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES negotiation_sessions(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES drivers(id),

    -- Offer details
    offered_price DECIMAL(10,2) NOT NULL,
    currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',

    -- Driver context at time of offer
    driver_latitude DECIMAL(10,8),
    driver_longitude DECIMAL(11,8),
    estimated_pickup_time INTEGER, -- minutes
    driver_rating DECIMAL(3,2),
    driver_total_rides INTEGER,
    vehicle_model VARCHAR(100),
    vehicle_color VARCHAR(50),

    -- Offer state
    status VARCHAR(20) NOT NULL DEFAULT 'pending',

    -- Counter-offer support
    is_counter_offer BOOLEAN NOT NULL DEFAULT false,
    parent_offer_id UUID REFERENCES negotiation_offers(id),
    counter_by VARCHAR(10), -- 'rider' or 'driver'

    -- Timing
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    expired_at TIMESTAMPTZ,

    CONSTRAINT chk_offer_status CHECK (status IN (
        'pending',    -- Awaiting response
        'accepted',   -- Rider accepted this offer
        'rejected',   -- Rider rejected this offer
        'withdrawn',  -- Driver withdrew the offer
        'expired',    -- Offer timed out
        'superseded'  -- Newer offer from same driver
    )),
    CONSTRAINT chk_counter_by CHECK (counter_by IS NULL OR counter_by IN ('rider', 'driver'))
);

CREATE INDEX idx_negotiation_offers_session ON negotiation_offers(session_id);
CREATE INDEX idx_negotiation_offers_driver ON negotiation_offers(driver_id);
CREATE INDEX idx_negotiation_offers_status ON negotiation_offers(session_id, status) WHERE status = 'pending';
CREATE INDEX idx_negotiation_offers_created ON negotiation_offers(created_at DESC);

-- Ensure driver can only have one active offer per session
CREATE UNIQUE INDEX idx_negotiation_offers_unique_active
ON negotiation_offers(session_id, driver_id)
WHERE status = 'pending';

-- ========================================
-- DRIVER PRICING STATISTICS
-- ========================================

CREATE TABLE driver_pricing_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    region_id UUID REFERENCES regions(id),
    city_id UUID REFERENCES cities(id),

    -- Pricing behavior
    total_offers INTEGER NOT NULL DEFAULT 0,
    accepted_offers INTEGER NOT NULL DEFAULT 0,
    average_offer_price DECIMAL(10,2),
    average_accepted_price DECIMAL(10,2),

    -- Fairness metrics
    price_deviation_avg DECIMAL(5,2), -- Average deviation from fair price
    high_price_offers INTEGER NOT NULL DEFAULT 0, -- Offers > 120% of fair price
    low_price_offers INTEGER NOT NULL DEFAULT 0,  -- Offers < 80% of fair price

    -- Reputation
    pricing_fairness_score DECIMAL(3,2) DEFAULT 1.00, -- 0.00 to 1.00
    response_rate DECIMAL(3,2) DEFAULT 0.00,
    average_response_time INTEGER, -- seconds

    -- Anti-fraud tracking
    consecutive_high_offers INTEGER NOT NULL DEFAULT 0,
    flagged_for_review BOOLEAN NOT NULL DEFAULT false,
    last_reviewed_at TIMESTAMPTZ,

    -- Timing
    period_start DATE NOT NULL DEFAULT CURRENT_DATE,
    period_end DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(driver_id, region_id, city_id, period_start)
);

CREATE INDEX idx_driver_pricing_stats_driver ON driver_pricing_stats(driver_id);
CREATE INDEX idx_driver_pricing_stats_region ON driver_pricing_stats(region_id) WHERE region_id IS NOT NULL;
CREATE INDEX idx_driver_pricing_stats_city ON driver_pricing_stats(city_id) WHERE city_id IS NOT NULL;
CREATE INDEX idx_driver_pricing_stats_flagged ON driver_pricing_stats(flagged_for_review) WHERE flagged_for_review = true;

-- ========================================
-- ROUTE PRICE HISTORY
-- ========================================

-- Stores historical pricing data for ML-based fair price calculation
CREATE TABLE route_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Route definition (H3 cells for pickup/dropoff)
    pickup_h3_index VARCHAR(20) NOT NULL,
    dropoff_h3_index VARCHAR(20) NOT NULL,

    -- Location context
    country_id UUID REFERENCES countries(id),
    region_id UUID REFERENCES regions(id),
    city_id UUID REFERENCES cities(id),

    -- Route characteristics
    distance_km DECIMAL(10,2) NOT NULL,
    duration_min INTEGER NOT NULL,

    -- Price data
    system_estimate DECIMAL(10,2) NOT NULL,
    final_price DECIMAL(10,2) NOT NULL,
    was_negotiated BOOLEAN NOT NULL DEFAULT false,
    negotiation_rounds INTEGER,

    -- Context at time of ride
    day_of_week INTEGER NOT NULL,
    hour_of_day INTEGER NOT NULL,
    weather_condition VARCHAR(50),
    surge_multiplier DECIMAL(3,2),

    -- Aggregation support
    sample_count INTEGER NOT NULL DEFAULT 1,
    price_sum DECIMAL(12,2) NOT NULL,
    price_sum_sq DECIMAL(14,2) NOT NULL, -- For variance calculation

    -- Timing
    ride_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Composite index for route lookups
CREATE INDEX idx_route_price_h3 ON route_price_history(pickup_h3_index, dropoff_h3_index);
CREATE INDEX idx_route_price_city ON route_price_history(city_id, ride_date);
CREATE INDEX idx_route_price_date ON route_price_history(ride_date DESC);
CREATE INDEX idx_route_price_time ON route_price_history(day_of_week, hour_of_day);

-- ========================================
-- NEGOTIATION SETTINGS PER REGION
-- ========================================

CREATE TABLE negotiation_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id UUID REFERENCES countries(id) ON DELETE CASCADE,
    region_id UUID REFERENCES regions(id) ON DELETE CASCADE,
    city_id UUID REFERENCES cities(id) ON DELETE CASCADE,

    -- Feature flags
    negotiation_enabled BOOLEAN NOT NULL DEFAULT true,

    -- Session settings
    session_timeout_seconds INTEGER NOT NULL DEFAULT 300, -- 5 minutes
    max_offers_per_session INTEGER NOT NULL DEFAULT 20,
    max_counter_offers INTEGER NOT NULL DEFAULT 3,
    offer_timeout_seconds INTEGER NOT NULL DEFAULT 60,

    -- Price bounds
    min_price_multiplier DECIMAL(3,2) NOT NULL DEFAULT 0.70, -- 70% of estimate
    max_price_multiplier DECIMAL(3,2) NOT NULL DEFAULT 1.50, -- 150% of estimate

    -- Driver limits
    max_active_sessions_per_driver INTEGER NOT NULL DEFAULT 5,
    min_driver_rating_to_negotiate DECIMAL(3,2) DEFAULT 4.0,
    min_driver_rides_to_negotiate INTEGER DEFAULT 10,

    -- Anti-fraud
    block_drivers_with_high_price_streak INTEGER DEFAULT 5,
    price_deviation_threshold DECIMAL(3,2) DEFAULT 0.30, -- 30%

    -- Timing
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_scope CHECK (
        (country_id IS NOT NULL AND region_id IS NULL AND city_id IS NULL) OR
        (region_id IS NOT NULL AND city_id IS NULL) OR
        (city_id IS NOT NULL) OR
        (country_id IS NULL AND region_id IS NULL AND city_id IS NULL)
    )
);

CREATE INDEX idx_negotiation_settings_country ON negotiation_settings(country_id) WHERE country_id IS NOT NULL;
CREATE INDEX idx_negotiation_settings_region ON negotiation_settings(region_id) WHERE region_id IS NOT NULL;
CREATE INDEX idx_negotiation_settings_city ON negotiation_settings(city_id) WHERE city_id IS NOT NULL;

-- ========================================
-- NEGOTIATION AUDIT LOG
-- ========================================

CREATE TABLE negotiation_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES negotiation_sessions(id) ON DELETE CASCADE,
    offer_id UUID REFERENCES negotiation_offers(id) ON DELETE CASCADE,
    actor_type VARCHAR(20) NOT NULL, -- 'rider', 'driver', 'system'
    actor_id UUID,
    action VARCHAR(50) NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_negotiation_audit_session ON negotiation_audit_logs(session_id);
CREATE INDEX idx_negotiation_audit_actor ON negotiation_audit_logs(actor_type, actor_id);
CREATE INDEX idx_negotiation_audit_created ON negotiation_audit_logs(created_at DESC);

-- ========================================
-- DRIVER NEGOTIATION PARTICIPATION
-- ========================================

-- Tracks which drivers have been notified/invited to a session
CREATE TABLE negotiation_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES negotiation_sessions(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES drivers(id),

    -- Notification status
    notified_at TIMESTAMPTZ,
    notification_method VARCHAR(20), -- 'websocket', 'push', 'both'

    -- Engagement
    viewed_at TIMESTAMPTZ,
    responded_at TIMESTAMPTZ,
    response_type VARCHAR(20), -- 'offer', 'decline', 'ignore'

    -- Distance at notification time
    distance_to_pickup DECIMAL(10,2),
    estimated_arrival_min INTEGER,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(session_id, driver_id)
);

CREATE INDEX idx_negotiation_participants_session ON negotiation_participants(session_id);
CREATE INDEX idx_negotiation_participants_driver ON negotiation_participants(driver_id);

-- ========================================
-- TRIGGERS
-- ========================================

CREATE TRIGGER update_negotiation_sessions_updated_at BEFORE UPDATE ON negotiation_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_driver_pricing_stats_updated_at BEFORE UPDATE ON driver_pricing_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_negotiation_settings_updated_at BEFORE UPDATE ON negotiation_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- SEED DEFAULT SETTINGS
-- ========================================

-- Global default negotiation settings
INSERT INTO negotiation_settings (
    negotiation_enabled,
    session_timeout_seconds,
    max_offers_per_session,
    max_counter_offers,
    offer_timeout_seconds,
    min_price_multiplier,
    max_price_multiplier,
    max_active_sessions_per_driver,
    min_driver_rating_to_negotiate,
    min_driver_rides_to_negotiate,
    block_drivers_with_high_price_streak,
    price_deviation_threshold
) VALUES (
    true,
    300,    -- 5 minutes session timeout
    20,     -- Max 20 offers per session
    3,      -- Max 3 counter-offers per driver
    60,     -- 60 seconds per offer
    0.70,   -- Min 70% of estimate
    1.50,   -- Max 150% of estimate
    5,      -- Max 5 active sessions per driver
    4.0,    -- Min 4.0 rating
    10,     -- Min 10 rides completed
    5,      -- Block after 5 consecutive high offers
    0.30    -- 30% deviation threshold
);
