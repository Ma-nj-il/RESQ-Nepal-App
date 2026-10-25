-- Drop indexes for driver_locations
DROP INDEX IF EXISTS idx_driver_locations_driver_time;
DROP INDEX IF EXISTS idx_driver_locations_recorded_at;
DROP INDEX IF EXISTS idx_driver_locations_driver_id;

-- Drop indexes for favorite_locations
DROP INDEX IF EXISTS idx_favorite_locations_name;
DROP INDEX IF EXISTS idx_favorite_locations_user_id;

-- Drop trigger for favorite_locations
DROP TRIGGER IF EXISTS update_favorite_locations_updated_at ON favorite_locations;

-- Drop tables
DROP TABLE IF EXISTS driver_locations;
DROP TABLE IF EXISTS favorite_locations;
