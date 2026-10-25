-- Ensure UUID extension is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Add missing favorite_locations table
CREATE TABLE favorite_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    address TEXT NOT NULL,
    latitude DECIMAL(10,8) NOT NULL,
    longitude DECIMAL(11,8) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add missing driver_locations table for location history tracking
CREATE TABLE driver_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    latitude DECIMAL(10,8) NOT NULL,
    longitude DECIMAL(11,8) NOT NULL,
    accuracy DECIMAL(6,2),
    speed DECIMAL(6,2),
    heading DECIMAL(5,2),
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for favorite_locations
CREATE INDEX idx_favorite_locations_user_id ON favorite_locations(user_id);
CREATE INDEX idx_favorite_locations_name ON favorite_locations(user_id, name);

-- Indexes for driver_locations
CREATE INDEX idx_driver_locations_driver_id ON driver_locations(driver_id);
CREATE INDEX idx_driver_locations_recorded_at ON driver_locations(recorded_at);
CREATE INDEX idx_driver_locations_driver_time ON driver_locations(driver_id, recorded_at DESC);

-- Add trigger for favorite_locations updated_at
CREATE TRIGGER update_favorite_locations_updated_at BEFORE UPDATE ON favorite_locations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
