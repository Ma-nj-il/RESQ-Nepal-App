import type { MigrationInterface, QueryRunner } from 'typeorm';

export const CORE_DISPATCH_SQL = String.raw`
CREATE SCHEMA IF NOT EXISTS dispatch;
CREATE SCHEMA IF NOT EXISTS tracking;
CREATE SCHEMA IF NOT EXISTS safety;

ALTER TABLE governance.job_intents DROP CONSTRAINT job_intent_state;
ALTER TABLE governance.job_intents ADD CONSTRAINT job_intent_state CHECK (
  state IN ('PENDING','ENQUEUEING','ENQUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')
);
ALTER TABLE governance.job_intents DROP CONSTRAINT job_intent_completion_shape;
ALTER TABLE governance.job_intents ADD CONSTRAINT job_intent_completion_shape CHECK (
  (state IN ('PENDING','ENQUEUEING','ENQUEUED','RUNNING') AND
    completed_at IS NULL AND result_code IS NULL AND error_code IS NULL) OR
  (state IN ('SUCCEEDED','CANCELLED') AND
    completed_at IS NOT NULL AND result_code IS NOT NULL AND error_code IS NULL) OR
  (state = 'FAILED' AND completed_at IS NOT NULL AND error_code IS NOT NULL)
);
CREATE INDEX job_intents_enqueue_recovery_idx
  ON governance.job_intents (state, updated_at, run_at, id)
  WHERE state IN ('ENQUEUEING','ENQUEUED','RUNNING');

REVOKE ALL ON SCHEMA dispatch FROM PUBLIC;
REVOKE ALL ON SCHEMA tracking FROM PUBLIC;
REVOKE ALL ON SCHEMA safety FROM PUBLIC;

CREATE TABLE dispatch.service_coverage_areas (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  service_category varchar(96) NOT NULL,
  center_latitude numeric(9,6) NOT NULL,
  center_longitude numeric(9,6) NOT NULL,
  radius_meters integer NOT NULL,
  base_fare_minor bigint NOT NULL,
  per_kilometer_fare_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  active boolean NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, facility_id, service_category),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id),
  CONSTRAINT coverage_latitude CHECK (center_latitude BETWEEN -90 AND 90),
  CONSTRAINT coverage_longitude CHECK (center_longitude BETWEEN -180 AND 180),
  CONSTRAINT coverage_radius CHECK (radius_meters BETWEEN 100 AND 500000),
  CONSTRAINT coverage_fare CHECK (base_fare_minor >= 0 AND per_kilometer_fare_minor >= 0),
  CONSTRAINT coverage_currency CHECK (currency = 'NPR'),
  CONSTRAINT coverage_version CHECK (version > 0),
  CONSTRAINT coverage_time_order CHECK (updated_at >= created_at)
);

CREATE TABLE dispatch.fare_quotes (
  id uuid PRIMARY KEY,
  requester_user_id uuid NOT NULL REFERENCES identity.users(id),
  coverage_area_id uuid NOT NULL REFERENCES dispatch.service_coverage_areas(id),
  service_category varchar(96) NOT NULL,
  pickup_latitude numeric(9,6) NOT NULL,
  pickup_longitude numeric(9,6) NOT NULL,
  destination_latitude numeric(9,6) NOT NULL,
  destination_longitude numeric(9,6) NOT NULL,
  distance_meters integer NOT NULL,
  duration_seconds integer NOT NULL,
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  route_source varchar(96) NOT NULL,
  route_quality varchar(32) NOT NULL,
  policy_version varchar(64) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (id, requester_user_id),
  CONSTRAINT fare_quote_pickup_latitude CHECK (pickup_latitude BETWEEN -90 AND 90),
  CONSTRAINT fare_quote_pickup_longitude CHECK (pickup_longitude BETWEEN -180 AND 180),
  CONSTRAINT fare_quote_destination_latitude CHECK (destination_latitude BETWEEN -90 AND 90),
  CONSTRAINT fare_quote_destination_longitude CHECK (destination_longitude BETWEEN -180 AND 180),
  CONSTRAINT fare_quote_distance CHECK (distance_meters > 0),
  CONSTRAINT fare_quote_duration CHECK (duration_seconds > 0),
  CONSTRAINT fare_quote_amount CHECK (amount_minor >= 0),
  CONSTRAINT fare_quote_currency CHECK (currency = 'NPR'),
  CONSTRAINT fare_quote_quality CHECK (route_quality IN ('PROVIDER_ROUTE','DEVELOPMENT_ESTIMATE')),
  CONSTRAINT fare_quote_version CHECK (version > 0),
  CONSTRAINT fare_quote_expiry CHECK (expires_at > created_at)
);
CREATE INDEX fare_quotes_requester_idx
  ON dispatch.fare_quotes (requester_user_id, created_at DESC, id);

CREATE TABLE dispatch.bookings (
  id uuid PRIMARY KEY,
  booking_reference varchar(32) NOT NULL UNIQUE,
  requester_user_id uuid NOT NULL REFERENCES identity.users(id),
  fare_quote_id uuid REFERENCES dispatch.fare_quotes(id),
  pickup_geographic_unit_id uuid NOT NULL REFERENCES geography.geographic_units(id),
  destination_geographic_unit_id uuid REFERENCES geography.geographic_units(id),
  service_category varchar(96) NOT NULL,
  urgency varchar(24) NOT NULL,
  payment_method varchar(24) NOT NULL,
  pickup_latitude numeric(9,6) NOT NULL,
  pickup_longitude numeric(9,6) NOT NULL,
  destination_latitude numeric(9,6) NOT NULL,
  destination_longitude numeric(9,6) NOT NULL,
  patient_payload_ciphertext bytea NOT NULL,
  patient_payload_nonce bytea NOT NULL,
  patient_payload_tag bytea NOT NULL,
  patient_payload_key_version varchar(128) NOT NULL,
  consent_flags jsonb NOT NULL,
  status varchar(32) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  search_deadline timestamptz NOT NULL,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (fare_quote_id, requester_user_id)
    REFERENCES dispatch.fare_quotes(id, requester_user_id),
  CONSTRAINT booking_status CHECK (
    status IN ('REQUESTED','SEARCHING','PROVIDER_ACCEPTED','ACTIVE','COMPLETED','CANCELLED','UNFULFILLED')
  ),
  CONSTRAINT booking_urgency CHECK (urgency IN ('ROUTINE','URGENT','EMERGENCY')),
  CONSTRAINT booking_payment_method CHECK (payment_method = 'CASH'),
  CONSTRAINT booking_pickup_latitude CHECK (pickup_latitude BETWEEN -90 AND 90),
  CONSTRAINT booking_pickup_longitude CHECK (pickup_longitude BETWEEN -180 AND 180),
  CONSTRAINT booking_destination_latitude CHECK (destination_latitude BETWEEN -90 AND 90),
  CONSTRAINT booking_destination_longitude CHECK (destination_longitude BETWEEN -180 AND 180),
  CONSTRAINT booking_payload_nonce CHECK (octet_length(patient_payload_nonce) = 12),
  CONSTRAINT booking_payload_tag CHECK (octet_length(patient_payload_tag) = 16),
  CONSTRAINT booking_consent_object CHECK (jsonb_typeof(consent_flags) = 'object'),
  CONSTRAINT booking_version CHECK (version > 0),
  CONSTRAINT booking_terminal_shape CHECK (
    (status = 'COMPLETED' AND completed_at IS NOT NULL AND cancelled_at IS NULL) OR
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND completed_at IS NULL) OR
    (status NOT IN ('COMPLETED','CANCELLED') AND completed_at IS NULL AND cancelled_at IS NULL)
  ),
  CONSTRAINT booking_time_order CHECK (
    updated_at >= created_at AND search_deadline > created_at AND
    (completed_at IS NULL OR completed_at >= created_at) AND
    (cancelled_at IS NULL OR cancelled_at >= created_at)
  )
);
CREATE INDEX bookings_requester_time_idx
  ON dispatch.bookings (requester_user_id, created_at DESC, id);
CREATE INDEX bookings_search_deadline_idx
  ON dispatch.bookings (search_deadline, id) WHERE status = 'SEARCHING';

CREATE TABLE dispatch.booking_transitions (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES dispatch.bookings(id),
  from_status varchar(32),
  to_status varchar(32) NOT NULL,
  actor_type varchar(32) NOT NULL,
  actor_id uuid,
  reason_code varchar(128) NOT NULL,
  reason varchar(1024),
  command_id varchar(160) NOT NULL,
  aggregate_version integer NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (booking_id, aggregate_version),
  CONSTRAINT booking_transition_actor CHECK (actor_type IN ('USER','WORKLOAD','SYSTEM_POLICY')),
  CONSTRAINT booking_transition_actor_shape CHECK (
    (actor_type IN ('USER','WORKLOAD') AND actor_id IS NOT NULL) OR actor_type = 'SYSTEM_POLICY'
  ),
  CONSTRAINT booking_transition_version CHECK (aggregate_version > 0)
);
CREATE INDEX booking_transitions_timeline_idx
  ON dispatch.booking_transitions (booking_id, aggregate_version, id);
CREATE TRIGGER booking_transitions_append_only
  BEFORE UPDATE OR DELETE ON dispatch.booking_transitions
  FOR EACH ROW EXECUTE FUNCTION governance.reject_row_mutation();

CREATE TABLE dispatch.dispatch_offers (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES dispatch.bookings(id),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  status varchar(24) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  response_reason_code varchar(128),
  response_reason varchar(1024),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, facility_id, id, booking_id),
  UNIQUE (booking_id, tenant_id, facility_id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id),
  CONSTRAINT dispatch_offer_status CHECK (
    status IN ('PENDING','ACCEPTED','DECLINED','EXPIRED','WITHDRAWN','SUPERSEDED')
  ),
  CONSTRAINT dispatch_offer_version CHECK (version > 0),
  CONSTRAINT dispatch_offer_response_shape CHECK (
    (status = 'PENDING' AND responded_at IS NULL AND response_reason_code IS NULL) OR
    (status <> 'PENDING' AND responded_at IS NOT NULL AND response_reason_code IS NOT NULL)
  ),
  CONSTRAINT dispatch_offer_time_order CHECK (
    updated_at >= created_at AND expires_at > created_at AND
    (responded_at IS NULL OR responded_at >= created_at)
  )
);
CREATE UNIQUE INDEX dispatch_offer_one_accepted_idx
  ON dispatch.dispatch_offers (booking_id) WHERE status = 'ACCEPTED';
CREATE INDEX dispatch_offer_queue_idx
  ON dispatch.dispatch_offers (tenant_id, facility_id, status, expires_at, id);

CREATE TABLE dispatch.booking_assignments (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL UNIQUE REFERENCES dispatch.bookings(id),
  offer_id uuid NOT NULL UNIQUE REFERENCES dispatch.dispatch_offers(id),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  ambulance_id uuid NOT NULL,
  dispatcher_user_id uuid NOT NULL REFERENCES identity.users(id),
  accepted_at timestamptz NOT NULL,
  released_at timestamptz,
  release_reason_code varchar(128),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, facility_id, id, booking_id, driver_id, ambulance_id),
  FOREIGN KEY (tenant_id, facility_id, offer_id, booking_id)
    REFERENCES dispatch.dispatch_offers(tenant_id, facility_id, id, booking_id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id),
  FOREIGN KEY (tenant_id, driver_id) REFERENCES workforce.driver_profiles(tenant_id, id),
  FOREIGN KEY (tenant_id, ambulance_id) REFERENCES fleet.ambulances(tenant_id, id),
  CONSTRAINT booking_assignment_release_shape CHECK (
    (released_at IS NULL AND release_reason_code IS NULL) OR
    (released_at IS NOT NULL AND release_reason_code IS NOT NULL AND released_at >= accepted_at)
  ),
  CONSTRAINT booking_assignment_version CHECK (version > 0)
);
CREATE UNIQUE INDEX booking_assignment_active_driver_idx
  ON dispatch.booking_assignments (driver_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX booking_assignment_active_ambulance_idx
  ON dispatch.booking_assignments (ambulance_id) WHERE released_at IS NULL;

CREATE TABLE dispatch.trips (
  id uuid PRIMARY KEY,
  assignment_id uuid NOT NULL UNIQUE,
  booking_id uuid NOT NULL UNIQUE REFERENCES dispatch.bookings(id),
  requester_user_id uuid NOT NULL REFERENCES identity.users(id),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  ambulance_id uuid NOT NULL,
  status varchar(40) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  pickup_odometer_meters bigint,
  completion_odometer_meters bigint,
  distance_meters bigint,
  final_fare_minor bigint,
  final_fare_currency char(3),
  final_fare_provenance varchar(96),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, facility_id, id),
  UNIQUE (tenant_id, facility_id, id, booking_id),
  FOREIGN KEY (tenant_id, facility_id, assignment_id, booking_id, driver_id, ambulance_id)
    REFERENCES dispatch.booking_assignments(
      tenant_id, facility_id, id, booking_id, driver_id, ambulance_id
    ),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id),
  FOREIGN KEY (tenant_id, driver_id) REFERENCES workforce.driver_profiles(tenant_id, id),
  FOREIGN KEY (tenant_id, ambulance_id) REFERENCES fleet.ambulances(tenant_id, id),
  CONSTRAINT trip_status CHECK (
    status IN ('ASSIGNED','PREPARING_TO_DEPART','EN_ROUTE_TO_PICKUP','ARRIVED_AT_PICKUP',
      'PATIENT_ON_BOARD','EN_ROUTE_TO_DESTINATION','ARRIVED_AT_DESTINATION','COMPLETED','CANCELLED')
  ),
  CONSTRAINT trip_version CHECK (version > 0),
  CONSTRAINT trip_measurements CHECK (
    (pickup_odometer_meters IS NULL OR pickup_odometer_meters >= 0) AND
    (completion_odometer_meters IS NULL OR completion_odometer_meters >= 0) AND
    (distance_meters IS NULL OR distance_meters >= 0) AND
    (final_fare_minor IS NULL OR final_fare_minor >= 0) AND
    (final_fare_currency IS NULL OR final_fare_currency = 'NPR')
  ),
  CONSTRAINT trip_terminal_shape CHECK (
    (status = 'COMPLETED' AND completed_at IS NOT NULL AND cancelled_at IS NULL AND
      final_fare_minor IS NOT NULL AND final_fare_currency IS NOT NULL AND final_fare_provenance IS NOT NULL) OR
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND completed_at IS NULL) OR
    (status NOT IN ('COMPLETED','CANCELLED') AND completed_at IS NULL AND cancelled_at IS NULL)
  ),
  CONSTRAINT trip_time_order CHECK (
    updated_at >= created_at AND (started_at IS NULL OR started_at >= created_at) AND
    (completed_at IS NULL OR completed_at >= created_at) AND
    (cancelled_at IS NULL OR cancelled_at >= created_at)
  )
);
CREATE UNIQUE INDEX trips_active_driver_idx
  ON dispatch.trips (driver_id) WHERE status NOT IN ('COMPLETED','CANCELLED');
CREATE UNIQUE INDEX trips_active_ambulance_idx
  ON dispatch.trips (ambulance_id) WHERE status NOT IN ('COMPLETED','CANCELLED');
CREATE INDEX trips_tenant_status_idx ON dispatch.trips (tenant_id, facility_id, status, id);
CREATE INDEX trips_requester_time_idx ON dispatch.trips (requester_user_id, created_at DESC, id);

CREATE TABLE dispatch.trip_transitions (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES dispatch.trips(id),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  from_status varchar(40),
  to_status varchar(40) NOT NULL,
  command varchar(64) NOT NULL,
  actor_type varchar(32) NOT NULL,
  actor_id uuid,
  reason_code varchar(128) NOT NULL,
  reason varchar(1024),
  command_id varchar(160) NOT NULL,
  aggregate_version integer NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (trip_id, aggregate_version),
  FOREIGN KEY (tenant_id, trip_id) REFERENCES dispatch.trips(tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id),
  CONSTRAINT trip_transition_actor CHECK (actor_type IN ('USER','WORKLOAD','SYSTEM_POLICY')),
  CONSTRAINT trip_transition_actor_shape CHECK (
    (actor_type IN ('USER','WORKLOAD') AND actor_id IS NOT NULL) OR actor_type = 'SYSTEM_POLICY'
  ),
  CONSTRAINT trip_transition_version CHECK (aggregate_version > 0)
);
CREATE INDEX trip_transitions_timeline_idx
  ON dispatch.trip_transitions (trip_id, aggregate_version, id);
CREATE TRIGGER trip_transitions_append_only
  BEFORE UPDATE OR DELETE ON dispatch.trip_transitions
  FOR EACH ROW EXECUTE FUNCTION governance.reject_row_mutation();

CREATE TABLE dispatch.cancellations (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES dispatch.bookings(id),
  trip_id uuid REFERENCES dispatch.trips(id),
  tenant_id uuid,
  facility_id uuid,
  actor_class varchar(32) NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES identity.users(id),
  policy_code varchar(96) NOT NULL,
  policy_version varchar(64) NOT NULL,
  reason_code varchar(128) NOT NULL,
  reason varchar(1024) NOT NULL,
  fee_minor bigint NOT NULL,
  fee_currency char(3) NOT NULL,
  fee_waived boolean NOT NULL,
  lifecycle_point varchar(40) NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id),
  CONSTRAINT cancellation_actor_class CHECK (actor_class IN ('REQUESTER','PROVIDER','CREW','AUTHORITY')),
  CONSTRAINT cancellation_tenant_shape CHECK (
    (actor_class = 'REQUESTER' AND tenant_id IS NULL AND facility_id IS NULL) OR
    (actor_class <> 'REQUESTER' AND tenant_id IS NOT NULL AND facility_id IS NOT NULL)
  ),
  CONSTRAINT cancellation_fee CHECK (fee_minor >= 0 AND fee_currency = 'NPR')
);
CREATE INDEX cancellations_booking_idx ON dispatch.cancellations (booking_id, created_at, id);
CREATE TRIGGER cancellations_append_only
  BEFORE UPDATE OR DELETE ON dispatch.cancellations
  FOR EACH ROW EXECUTE FUNCTION governance.reject_row_mutation();

CREATE TABLE tracking.location_points (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  source_device_id uuid NOT NULL,
  point_id uuid NOT NULL,
  sequence bigint NOT NULL,
  latitude numeric(9,6) NOT NULL,
  longitude numeric(9,6) NOT NULL,
  accuracy_meters numeric(8,2) NOT NULL,
  heading_degrees numeric(6,2),
  speed_meters_per_second numeric(8,2),
  quality varchar(24) NOT NULL,
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  UNIQUE (trip_id, source_device_id, point_id),
  UNIQUE (trip_id, source_device_id, sequence),
  FOREIGN KEY (tenant_id, facility_id, trip_id)
    REFERENCES dispatch.trips(tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id),
  CONSTRAINT location_sequence CHECK (sequence > 0),
  CONSTRAINT location_latitude CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT location_longitude CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT location_accuracy CHECK (accuracy_meters BETWEEN 0 AND 500),
  CONSTRAINT location_heading CHECK (heading_degrees IS NULL OR heading_degrees BETWEEN 0 AND 360),
  CONSTRAINT location_speed CHECK (speed_meters_per_second IS NULL OR speed_meters_per_second BETWEEN 0 AND 100),
  CONSTRAINT location_quality CHECK (quality IN ('GOOD','REDUCED','POOR')),
  CONSTRAINT location_time_order CHECK (received_at >= captured_at - interval '5 minutes')
);
CREATE INDEX location_points_trip_time_idx
  ON tracking.location_points (trip_id, captured_at DESC, id);

CREATE TABLE tracking.trip_tracking_state (
  trip_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  last_location_point_id uuid NOT NULL REFERENCES tracking.location_points(id),
  last_sequence bigint NOT NULL,
  last_captured_at timestamptz NOT NULL,
  last_received_at timestamptz NOT NULL,
  source_quality varchar(24) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, facility_id, trip_id)
    REFERENCES dispatch.trips(tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id),
  CONSTRAINT tracking_state_sequence CHECK (last_sequence > 0),
  CONSTRAINT tracking_state_version CHECK (version > 0),
  CONSTRAINT tracking_state_time_order CHECK (
    last_received_at >= last_captured_at - interval '5 minutes' AND
    updated_at >= last_received_at
  )
);

CREATE TABLE safety.safety_incidents (
  id uuid PRIMARY KEY,
  creator_user_id uuid NOT NULL REFERENCES identity.users(id),
  trip_id uuid,
  booking_id uuid,
  tenant_id uuid,
  facility_id uuid,
  incident_type varchar(40) NOT NULL,
  severity varchar(24) NOT NULL,
  status varchar(24) NOT NULL,
  escalation_tier integer NOT NULL DEFAULT 0,
  details_ciphertext bytea NOT NULL,
  details_nonce bytea NOT NULL,
  details_tag bytea NOT NULL,
  details_key_version varchar(128) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  acknowledged_by_user_id uuid REFERENCES identity.users(id),
  acknowledged_at timestamptz,
  resolved_by_user_id uuid REFERENCES identity.users(id),
  resolved_at timestamptz,
  resolution_code varchar(128),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id, trip_id, booking_id)
    REFERENCES dispatch.trips(tenant_id, facility_id, id, booking_id),
  CONSTRAINT safety_incident_type CHECK (incident_type IN ('SOS','SAFETY_CONCERN','ROUTE_DEVIATION')),
  CONSTRAINT safety_incident_severity CHECK (severity IN ('CRITICAL','HIGH','MEDIUM')),
  CONSTRAINT safety_incident_status CHECK (status IN ('OPEN','ACKNOWLEDGED','ESCALATED','RESOLVED')),
  CONSTRAINT safety_incident_tier CHECK (escalation_tier BETWEEN 0 AND 5),
  CONSTRAINT safety_incident_trip_shape CHECK (
    (trip_id IS NULL AND booking_id IS NULL AND tenant_id IS NULL AND facility_id IS NULL) OR
    (trip_id IS NOT NULL AND booking_id IS NOT NULL AND tenant_id IS NOT NULL AND facility_id IS NOT NULL)
  ),
  CONSTRAINT safety_incident_nonce CHECK (octet_length(details_nonce) = 12),
  CONSTRAINT safety_incident_tag CHECK (octet_length(details_tag) = 16),
  CONSTRAINT safety_incident_ack_shape CHECK (
    (status = 'OPEN' AND acknowledged_by_user_id IS NULL AND acknowledged_at IS NULL) OR
    (status = 'ESCALATED' AND (
      (acknowledged_by_user_id IS NULL AND acknowledged_at IS NULL) OR
      (acknowledged_by_user_id IS NOT NULL AND acknowledged_at IS NOT NULL)
    )) OR
    (status IN ('ACKNOWLEDGED','RESOLVED') AND
      acknowledged_by_user_id IS NOT NULL AND acknowledged_at IS NOT NULL)
  ),
  CONSTRAINT safety_incident_resolution_shape CHECK (
    (status = 'RESOLVED' AND resolved_by_user_id IS NOT NULL AND resolved_at IS NOT NULL AND resolution_code IS NOT NULL) OR
    (status <> 'RESOLVED' AND resolved_by_user_id IS NULL AND resolved_at IS NULL AND resolution_code IS NULL)
  ),
  CONSTRAINT safety_incident_version CHECK (version > 0),
  CONSTRAINT safety_incident_time_order CHECK (
    updated_at >= created_at AND (acknowledged_at IS NULL OR acknowledged_at >= created_at) AND
    (resolved_at IS NULL OR resolved_at >= created_at)
  )
);
CREATE INDEX safety_incidents_creator_idx
  ON safety.safety_incidents (creator_user_id, created_at DESC, id);
CREATE INDEX safety_incidents_queue_idx
  ON safety.safety_incidents (tenant_id, facility_id, status, severity, created_at, id)
  WHERE status <> 'RESOLVED';

CREATE TABLE safety.safety_incident_events (
  id uuid PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES safety.safety_incidents(id),
  event_type varchar(40) NOT NULL,
  actor_type varchar(32) NOT NULL,
  actor_id uuid,
  escalation_tier integer NOT NULL,
  outcome_code varchar(128) NOT NULL,
  reason varchar(1024),
  aggregate_version integer NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (incident_id, aggregate_version),
  CONSTRAINT safety_event_type CHECK (event_type IN ('CREATED','ACKNOWLEDGED','ESCALATED','RESOLVED','DELIVERY_OUTCOME')),
  CONSTRAINT safety_event_actor CHECK (actor_type IN ('USER','WORKLOAD','SYSTEM_POLICY')),
  CONSTRAINT safety_event_actor_shape CHECK (
    (actor_type IN ('USER','WORKLOAD') AND actor_id IS NOT NULL) OR actor_type = 'SYSTEM_POLICY'
  ),
  CONSTRAINT safety_event_tier CHECK (escalation_tier BETWEEN 0 AND 5),
  CONSTRAINT safety_event_version CHECK (aggregate_version > 0)
);
CREATE INDEX safety_incident_events_timeline_idx
  ON safety.safety_incident_events (incident_id, aggregate_version, id);
CREATE TRIGGER safety_incident_events_append_only
  BEFORE UPDATE OR DELETE ON safety.safety_incident_events
  FOR EACH ROW EXECUTE FUNCTION governance.reject_row_mutation();

CREATE OR REPLACE FUNCTION dispatch.guard_booking_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF OLD.id::text IS DISTINCT FROM current_setting('app.dispatch_command_booking_id', true) THEN
    RAISE EXCEPTION 'booking lifecycle changes require a named command' USING ERRCODE = '42501';
  END IF;
  IF (OLD.id, OLD.booking_reference, OLD.requester_user_id, OLD.fare_quote_id,
      OLD.pickup_geographic_unit_id, OLD.destination_geographic_unit_id, OLD.service_category,
      OLD.urgency, OLD.payment_method, OLD.pickup_latitude, OLD.pickup_longitude,
      OLD.destination_latitude, OLD.destination_longitude, OLD.patient_payload_ciphertext,
      OLD.patient_payload_nonce, OLD.patient_payload_tag, OLD.patient_payload_key_version,
      OLD.consent_flags, OLD.search_deadline, OLD.created_at)
     IS DISTINCT FROM
     (NEW.id, NEW.booking_reference, NEW.requester_user_id, NEW.fare_quote_id,
      NEW.pickup_geographic_unit_id, NEW.destination_geographic_unit_id, NEW.service_category,
      NEW.urgency, NEW.payment_method, NEW.pickup_latitude, NEW.pickup_longitude,
      NEW.destination_latitude, NEW.destination_longitude, NEW.patient_payload_ciphertext,
      NEW.patient_payload_nonce, NEW.patient_payload_tag, NEW.patient_payload_key_version,
      NEW.consent_flags, NEW.search_deadline, NEW.created_at) OR
     NEW.version <= OLD.version OR NEW.version > OLD.version + 2 OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'invalid booking mutation' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('COMPLETED','CANCELLED','UNFULFILLED') THEN
    RAISE EXCEPTION 'terminal booking is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER booking_update_guard BEFORE UPDATE ON dispatch.bookings
  FOR EACH ROW EXECUTE FUNCTION dispatch.guard_booking_update();

CREATE OR REPLACE FUNCTION dispatch.guard_offer_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF OLD.booking_id::text IS DISTINCT FROM current_setting('app.dispatch_command_booking_id', true) OR
     OLD.status <> 'PENDING' OR NEW.version <> OLD.version + 1 OR
     (OLD.id, OLD.booking_id, OLD.tenant_id, OLD.facility_id, OLD.expires_at, OLD.created_at)
       IS DISTINCT FROM
     (NEW.id, NEW.booking_id, NEW.tenant_id, NEW.facility_id, NEW.expires_at, NEW.created_at) THEN
    RAISE EXCEPTION 'dispatch offer changes require a named command' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER dispatch_offer_update_guard BEFORE UPDATE ON dispatch.dispatch_offers
  FOR EACH ROW EXECUTE FUNCTION dispatch.guard_offer_update();

CREATE OR REPLACE FUNCTION dispatch.guard_trip_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF OLD.id::text IS DISTINCT FROM current_setting('app.trip_command_trip_id', true) OR
     NEW.version <> OLD.version + 1 OR
     (OLD.id, OLD.assignment_id, OLD.booking_id, OLD.requester_user_id, OLD.tenant_id,
      OLD.facility_id, OLD.driver_id, OLD.ambulance_id, OLD.created_at)
       IS DISTINCT FROM
     (NEW.id, NEW.assignment_id, NEW.booking_id, NEW.requester_user_id, NEW.tenant_id,
      NEW.facility_id, NEW.driver_id, NEW.ambulance_id, NEW.created_at) OR
     OLD.status IN ('COMPLETED','CANCELLED') THEN
    RAISE EXCEPTION 'trip lifecycle changes require a named command' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trip_update_guard BEFORE UPDATE ON dispatch.trips
  FOR EACH ROW EXECUTE FUNCTION dispatch.guard_trip_update();

CREATE OR REPLACE FUNCTION dispatch.find_service_coverage(
  selected_service_category varchar,
  selected_latitude numeric,
  selected_longitude numeric
)
RETURNS TABLE (
  coverage_area_id uuid,
  tenant_id uuid,
  facility_id uuid,
  service_category varchar,
  distance_to_center_meters integer,
  radius_meters integer,
  base_fare_minor bigint,
  per_kilometer_fare_minor bigint,
  currency char(3),
  version integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT candidate.id, candidate.tenant_id, candidate.facility_id, candidate.service_category,
         candidate.distance_meters, candidate.radius_meters, candidate.base_fare_minor,
         candidate.per_kilometer_fare_minor, candidate.currency, candidate.version
    FROM (
      SELECT coverage.*,
        round(6371000 * 2 * asin(sqrt(
          power(sin(radians((selected_latitude - coverage.center_latitude)::double precision) / 2), 2) +
          cos(radians(coverage.center_latitude::double precision)) *
          cos(radians(selected_latitude::double precision)) *
          power(sin(radians((selected_longitude - coverage.center_longitude)::double precision) / 2), 2)
        )))::integer AS distance_meters
        FROM dispatch.service_coverage_areas coverage
        JOIN tenancy.provider_organizations provider ON provider.id = coverage.tenant_id
        JOIN tenancy.facilities facility
          ON facility.tenant_id = coverage.tenant_id AND facility.id = coverage.facility_id
       WHERE coverage.active
         AND coverage.service_category = selected_service_category
         AND provider.operating_status = 'ACTIVE'
         AND facility.operating_status = 'ACTIVE'
    ) candidate
   WHERE candidate.distance_meters <= candidate.radius_meters
   ORDER BY candidate.distance_meters, candidate.id;
$function$;

CREATE OR REPLACE FUNCTION dispatch.user_is_booking_requester(
  selected_booking_id uuid,
  selected_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT selected_user_id IS NOT NULL AND
    selected_user_id = governance.current_setting_uuid('app.user_id') AND EXISTS (
    SELECT 1 FROM dispatch.bookings booking
     WHERE booking.id = selected_booking_id AND booking.requester_user_id = selected_user_id
  );
$function$;

CREATE OR REPLACE FUNCTION dispatch.cancellation_actor_class(selected_actor_user_id uuid)
RETURNS varchar
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT CASE
    WHEN selected_actor_user_id IS NULL OR
         selected_actor_user_id <> governance.current_setting_uuid('app.user_id') THEN NULL
    WHEN governance.current_setting_uuid('app.authority_grant_id') IS NOT NULL AND
         governance.current_setting_uuid('app.tenant_id') IS NOT NULL THEN NULL
    WHEN governance.current_setting_uuid('app.authority_grant_id') IS NOT NULL THEN 'AUTHORITY'
    WHEN governance.current_setting_uuid('app.tenant_id') IS NULL THEN 'REQUESTER'
    WHEN EXISTS (
      SELECT 1
        FROM workforce.driver_profiles driver
       WHERE driver.tenant_id = governance.current_setting_uuid('app.tenant_id')
         AND driver.user_id = selected_actor_user_id
    ) THEN 'CREW'
    ELSE 'PROVIDER'
  END;
$function$;

CREATE OR REPLACE FUNCTION dispatch.create_booking(
  selected_booking_id uuid,
  selected_booking_reference varchar,
  selected_fare_quote_id uuid,
  selected_pickup_geographic_unit_id uuid,
  selected_destination_geographic_unit_id uuid,
  selected_service_category varchar,
  selected_urgency varchar,
  selected_payment_method varchar,
  selected_pickup_latitude numeric,
  selected_pickup_longitude numeric,
  selected_destination_latitude numeric,
  selected_destination_longitude numeric,
  selected_patient_payload_ciphertext bytea,
  selected_patient_payload_nonce bytea,
  selected_patient_payload_tag bytea,
  selected_patient_payload_key_version varchar,
  selected_consent_flags jsonb,
  selected_transition_id uuid,
  selected_command_id varchar,
  selected_search_deadline timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  requester_id uuid := governance.current_setting_uuid('app.user_id');
  effective_at timestamptz := statement_timestamp();
BEGIN
  IF requester_id IS NULL OR selected_search_deadline <= effective_at OR
     selected_search_deadline > effective_at + interval '15 minutes' THEN
    RETURN false;
  END IF;
  IF selected_fare_quote_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dispatch.fare_quotes quote
     WHERE quote.id = selected_fare_quote_id
       AND quote.requester_user_id = requester_id
       AND quote.service_category = selected_service_category
       AND quote.pickup_latitude = selected_pickup_latitude
       AND quote.pickup_longitude = selected_pickup_longitude
       AND quote.destination_latitude = selected_destination_latitude
       AND quote.destination_longitude = selected_destination_longitude
       AND quote.expires_at > effective_at
  ) THEN RETURN false; END IF;
  INSERT INTO dispatch.bookings (
    id, booking_reference, requester_user_id, fare_quote_id,
    pickup_geographic_unit_id, destination_geographic_unit_id, service_category,
    urgency, payment_method, pickup_latitude, pickup_longitude,
    destination_latitude, destination_longitude, patient_payload_ciphertext,
    patient_payload_nonce, patient_payload_tag, patient_payload_key_version,
    consent_flags, status, version, search_deadline, created_at, updated_at
  ) VALUES (
    selected_booking_id, selected_booking_reference, requester_id, selected_fare_quote_id,
    selected_pickup_geographic_unit_id, selected_destination_geographic_unit_id,
    selected_service_category, selected_urgency, selected_payment_method,
    selected_pickup_latitude, selected_pickup_longitude, selected_destination_latitude,
    selected_destination_longitude, selected_patient_payload_ciphertext,
    selected_patient_payload_nonce, selected_patient_payload_tag,
    selected_patient_payload_key_version, selected_consent_flags, 'REQUESTED', 1,
    selected_search_deadline, effective_at, effective_at
  );
  INSERT INTO dispatch.booking_transitions (
    id, booking_id, from_status, to_status, actor_type, actor_id, reason_code,
    command_id, aggregate_version, created_at
  ) VALUES (
    selected_transition_id, selected_booking_id, NULL, 'REQUESTED', 'USER', requester_id,
    'BOOKING_REQUESTED', selected_command_id, 1, effective_at
  );
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION dispatch.start_booking_search(
  selected_booking_id uuid,
  expected_booking_version integer,
  selected_transition_id uuid,
  selected_command_id varchar,
  selected_offer_ids uuid[],
  selected_coverage_area_ids uuid[],
  offer_expires_at_value timestamptz
)
RETURNS varchar
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  booking dispatch.bookings%ROWTYPE;
  effective_at timestamptz := statement_timestamp();
  expected_count integer;
  eligible_count integer;
BEGIN
  SELECT * INTO booking FROM dispatch.bookings WHERE id = selected_booking_id FOR UPDATE;
  IF NOT FOUND OR booking.requester_user_id <> governance.current_setting_uuid('app.user_id') THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF booking.version <> expected_booking_version THEN RETURN 'STALE_VERSION'; END IF;
  IF booking.status <> 'REQUESTED' THEN RETURN 'INVALID_TRANSITION'; END IF;
  expected_count := cardinality(selected_offer_ids);
  IF expected_count IS NULL OR expected_count = 0 OR
     expected_count <> cardinality(selected_coverage_area_ids) OR
     expected_count <> (SELECT count(DISTINCT value) FROM unnest(selected_offer_ids) value) OR
     expected_count <> (SELECT count(DISTINCT value) FROM unnest(selected_coverage_area_ids) value) OR
     offer_expires_at_value <= effective_at OR offer_expires_at_value > booking.search_deadline THEN
    RETURN 'INVALID_COVERAGE';
  END IF;
  SELECT count(*) INTO eligible_count
    FROM dispatch.service_coverage_areas coverage
    JOIN tenancy.provider_organizations provider ON provider.id = coverage.tenant_id
    JOIN tenancy.facilities facility
      ON facility.tenant_id = coverage.tenant_id AND facility.id = coverage.facility_id
   WHERE coverage.id = ANY(selected_coverage_area_ids)
     AND coverage.active
     AND coverage.service_category = booking.service_category
     AND provider.operating_status = 'ACTIVE'
     AND facility.operating_status = 'ACTIVE'
     AND round(6371000 * 2 * asin(sqrt(
       power(sin(radians((booking.pickup_latitude - coverage.center_latitude)::double precision) / 2), 2) +
       cos(radians(coverage.center_latitude::double precision)) *
       cos(radians(booking.pickup_latitude::double precision)) *
       power(sin(radians((booking.pickup_longitude - coverage.center_longitude)::double precision) / 2), 2)
     )))::integer <= coverage.radius_meters;
  IF eligible_count <> expected_count THEN RETURN 'INVALID_COVERAGE'; END IF;

  PERFORM set_config('app.dispatch_command_booking_id', booking.id::text, true);
  INSERT INTO dispatch.dispatch_offers (
    id, booking_id, tenant_id, facility_id, status, expires_at, created_at, updated_at
  )
  SELECT pair.offer_id, booking.id, coverage.tenant_id, coverage.facility_id,
         'PENDING', offer_expires_at_value, effective_at, effective_at
    FROM unnest(selected_offer_ids, selected_coverage_area_ids) AS pair(offer_id, coverage_id)
    JOIN dispatch.service_coverage_areas coverage ON coverage.id = pair.coverage_id;
  INSERT INTO dispatch.booking_transitions (
    id, booking_id, from_status, to_status, actor_type, actor_id, reason_code,
    command_id, aggregate_version, created_at
  ) VALUES (
    selected_transition_id, booking.id, 'REQUESTED', 'SEARCHING', 'USER',
    booking.requester_user_id, 'DISPATCH_SEARCH_STARTED', selected_command_id,
    booking.version + 1, effective_at
  );
  UPDATE dispatch.bookings SET status = 'SEARCHING', version = version + 1,
    updated_at = effective_at WHERE id = booking.id;
  PERFORM set_config('app.dispatch_command_booking_id', '', true);
  RETURN 'SEARCHING';
EXCEPTION WHEN unique_violation THEN
  PERFORM set_config('app.dispatch_command_booking_id', '', true);
  RETURN 'CONFLICT';
END;
$function$;

CREATE OR REPLACE FUNCTION dispatch.booking_is_in_tenant_scope(selected_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM dispatch.dispatch_offers offer
     WHERE offer.booking_id = selected_booking_id
       AND governance.facility_is_in_scope(offer.tenant_id, offer.facility_id)
  ) OR EXISTS (
    SELECT 1 FROM dispatch.booking_assignments assignment
     WHERE assignment.booking_id = selected_booking_id
       AND governance.facility_is_in_scope(assignment.tenant_id, assignment.facility_id)
  );
$function$;

CREATE OR REPLACE FUNCTION dispatch.principal_can_write_booking_delivery(
  selected_booking_id uuid,
  selected_tenant_id uuid,
  selected_facility_id uuid,
  selected_actor_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT selected_actor_id IS NOT NULL AND
    selected_actor_id = governance.current_setting_uuid('app.user_id') AND
    EXISTS (
      SELECT 1 FROM dispatch.bookings booking
       WHERE booking.id = selected_booking_id
         AND booking.requester_user_id = selected_actor_id
    ) AND (
      (selected_tenant_id IS NULL AND selected_facility_id IS NULL) OR
      (selected_tenant_id IS NOT NULL AND selected_facility_id IS NULL AND (
        EXISTS (
          SELECT 1 FROM dispatch.dispatch_offers offer
           WHERE offer.booking_id = selected_booking_id
             AND offer.tenant_id = selected_tenant_id
        ) OR EXISTS (
          SELECT 1 FROM dispatch.booking_assignments assignment
           WHERE assignment.booking_id = selected_booking_id
             AND assignment.tenant_id = selected_tenant_id
        )
      )) OR
      (selected_tenant_id IS NOT NULL AND selected_facility_id IS NOT NULL AND (
        EXISTS (
          SELECT 1 FROM dispatch.dispatch_offers offer
           WHERE offer.booking_id = selected_booking_id
             AND offer.tenant_id = selected_tenant_id
             AND offer.facility_id = selected_facility_id
        ) OR EXISTS (
          SELECT 1 FROM dispatch.booking_assignments assignment
           WHERE assignment.booking_id = selected_booking_id
             AND assignment.tenant_id = selected_tenant_id
             AND assignment.facility_id = selected_facility_id
        )
      ))
    );
$function$;

CREATE OR REPLACE FUNCTION dispatch.principal_can_write_trip_delivery(
  selected_trip_id uuid,
  selected_tenant_id uuid,
  selected_facility_id uuid,
  selected_actor_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT selected_actor_id IS NOT NULL AND
    selected_actor_id = governance.current_setting_uuid('app.user_id') AND
    selected_tenant_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM dispatch.trips trip
       WHERE trip.id = selected_trip_id
         AND trip.requester_user_id = selected_actor_id
         AND trip.tenant_id = selected_tenant_id
         AND (
           selected_facility_id IS NULL OR
           trip.facility_id = selected_facility_id
         )
    );
$function$;

CREATE OR REPLACE FUNCTION dispatch.principal_can_write_offer_outcome_delivery(
  selected_offer_id uuid,
  selected_booking_id uuid,
  selected_tenant_id uuid,
  selected_facility_id uuid,
  selected_actor_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT selected_actor_id IS NOT NULL AND
    selected_actor_id = governance.current_setting_uuid('app.user_id') AND
    EXISTS (
      SELECT 1
        FROM dispatch.dispatch_offers target_offer
        JOIN dispatch.booking_assignments assignment
          ON assignment.booking_id = target_offer.booking_id
        JOIN dispatch.dispatch_offers accepted_offer
          ON accepted_offer.id = assignment.offer_id
       WHERE target_offer.id = selected_offer_id
         AND target_offer.booking_id = selected_booking_id
         AND target_offer.tenant_id = selected_tenant_id
         AND target_offer.facility_id = selected_facility_id
         AND target_offer.status IN ('ACCEPTED','SUPERSEDED')
         AND accepted_offer.status = 'ACCEPTED'
         AND assignment.dispatcher_user_id = selected_actor_id
         AND governance.facility_is_in_scope(assignment.tenant_id, assignment.facility_id)
    );
$function$;

CREATE OR REPLACE FUNCTION dispatch.authority_allows_booking(
  required_permission varchar,
  required_resource varchar,
  selected_booking_id uuid,
  evaluated_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM dispatch.bookings booking
     WHERE booking.id = selected_booking_id
       AND access_control.authority_allows(
         required_permission, required_resource, booking.pickup_geographic_unit_id, NULL, evaluated_at
       )
  );
$function$;

CREATE OR REPLACE FUNCTION dispatch.accept_offer(
  selected_offer_id uuid,
  expected_offer_version integer,
  selected_assignment_id uuid,
  selected_trip_id uuid,
  selected_offer_transition_id uuid,
  selected_active_transition_id uuid,
  selected_trip_transition_id uuid,
  selected_driver_id uuid,
  selected_ambulance_id uuid,
  selected_dispatcher_user_id uuid,
  selected_command_id varchar
)
RETURNS varchar
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  offer dispatch.dispatch_offers%ROWTYPE;
  booking dispatch.bookings%ROWTYPE;
  driver workforce.driver_profiles%ROWTYPE;
  ambulance fleet.ambulances%ROWTYPE;
  effective_at timestamptz := statement_timestamp();
BEGIN
  IF selected_dispatcher_user_id <> governance.current_setting_uuid('app.user_id') THEN
    RETURN 'NOT_AUTHORIZED';
  END IF;
  SELECT candidate_booking.* INTO booking
    FROM dispatch.bookings candidate_booking
   WHERE candidate_booking.id = (
     SELECT candidate_offer.booking_id
       FROM dispatch.dispatch_offers candidate_offer
      WHERE candidate_offer.id = selected_offer_id
   )
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  SELECT * INTO offer FROM dispatch.dispatch_offers
   WHERE id = selected_offer_id AND booking_id = booking.id FOR UPDATE;
  IF NOT FOUND OR NOT governance.facility_is_in_scope(offer.tenant_id, offer.facility_id) THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF offer.version <> expected_offer_version THEN RETURN 'STALE_VERSION'; END IF;
  IF offer.status <> 'PENDING' OR booking.status <> 'SEARCHING' THEN RETURN 'OFFER_RESOLVED'; END IF;
  IF offer.expires_at <= effective_at OR booking.search_deadline <= effective_at THEN
    RETURN 'OFFER_EXPIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenancy.provider_organizations provider
    JOIN tenancy.facilities facility ON facility.tenant_id = provider.id
     WHERE provider.id = offer.tenant_id AND facility.id = offer.facility_id
       AND provider.operating_status = 'ACTIVE' AND facility.operating_status = 'ACTIVE'
  ) THEN RETURN 'PROVIDER_NOT_ELIGIBLE'; END IF;

  SELECT * INTO driver FROM workforce.driver_profiles
   WHERE id = selected_driver_id AND tenant_id = offer.tenant_id FOR UPDATE;
  IF NOT FOUND OR driver.verification_status <> 'VERIFIED' OR driver.account_status <> 'ACTIVE' OR
      driver.duty_status <> 'AVAILABLE' OR driver.licence_expires_on < effective_at::date OR
     NOT EXISTS (
       SELECT 1 FROM workforce.driver_facility_assignments affiliation
        WHERE affiliation.tenant_id = offer.tenant_id AND affiliation.facility_id = offer.facility_id
          AND affiliation.driver_id = selected_driver_id AND affiliation.ended_at IS NULL
           AND affiliation.valid_from <= effective_at
           AND (affiliation.valid_until IS NULL OR affiliation.valid_until > effective_at)
     ) OR NOT EXISTS (
       SELECT 1 FROM documents.driver_documents document
       JOIN documents.document_objects object ON object.id = document.document_object_id
        WHERE document.tenant_id = offer.tenant_id AND document.driver_id = selected_driver_id
          AND document.review_status = 'APPROVED' AND object.upload_status = 'READY'
           AND (document.expires_on IS NULL OR document.expires_on >= effective_at::date)
     ) THEN RETURN 'DRIVER_NOT_ELIGIBLE'; END IF;

  SELECT * INTO ambulance FROM fleet.ambulances
   WHERE id = selected_ambulance_id AND tenant_id = offer.tenant_id FOR UPDATE;
  IF NOT FOUND OR ambulance.facility_id <> offer.facility_id OR
     ambulance.compliance_status <> 'APPROVED' OR ambulance.operational_status <> 'AVAILABLE' OR
     ambulance.readiness_status <> 'READY' OR cardinality(ambulance.readiness_reasons) <> 0 THEN
    RETURN 'AMBULANCE_NOT_ELIGIBLE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM dispatch.booking_assignments active
     WHERE active.released_at IS NULL AND
       (active.driver_id = selected_driver_id OR active.ambulance_id = selected_ambulance_id)
  ) THEN RETURN 'RESOURCE_CONFLICT'; END IF;

  PERFORM set_config('app.dispatch_command_booking_id', booking.id::text, true);
  UPDATE dispatch.dispatch_offers
     SET status = 'ACCEPTED', version = version + 1, responded_at = effective_at,
          response_reason_code = 'OFFER_ACCEPTED', response_reason = NULL, updated_at = effective_at
   WHERE id = offer.id;
  UPDATE dispatch.dispatch_offers
     SET status = 'SUPERSEDED', version = version + 1, responded_at = effective_at,
         response_reason_code = 'ANOTHER_OFFER_ACCEPTED', response_reason = NULL,
          updated_at = effective_at
   WHERE booking_id = booking.id AND id <> offer.id AND status = 'PENDING';

  INSERT INTO dispatch.booking_assignments (
    id, booking_id, offer_id, tenant_id, facility_id, driver_id, ambulance_id,
    dispatcher_user_id, accepted_at
  ) VALUES (
    selected_assignment_id, booking.id, offer.id, offer.tenant_id, offer.facility_id,
    selected_driver_id, selected_ambulance_id, selected_dispatcher_user_id, effective_at
  );
  INSERT INTO dispatch.trips (
    id, assignment_id, booking_id, requester_user_id, tenant_id, facility_id,
    driver_id, ambulance_id, status, created_at, updated_at
  ) VALUES (
    selected_trip_id, selected_assignment_id, booking.id, booking.requester_user_id,
    offer.tenant_id, offer.facility_id, selected_driver_id, selected_ambulance_id,
    'ASSIGNED', effective_at, effective_at
  );
  INSERT INTO dispatch.booking_transitions (
    id, booking_id, from_status, to_status, actor_type, actor_id, reason_code,
    command_id, aggregate_version, created_at
  ) VALUES
    (selected_offer_transition_id, booking.id, 'SEARCHING', 'PROVIDER_ACCEPTED', 'USER',
      selected_dispatcher_user_id, 'OFFER_ACCEPTED', selected_command_id,
       booking.version + 1, effective_at),
    (selected_active_transition_id, booking.id, 'PROVIDER_ACCEPTED', 'ACTIVE', 'USER',
      selected_dispatcher_user_id, 'RESOURCES_ASSIGNED', selected_command_id,
       booking.version + 2, effective_at);
  INSERT INTO dispatch.trip_transitions (
    id, trip_id, tenant_id, facility_id, from_status, to_status, command,
    actor_type, actor_id, reason_code, command_id, aggregate_version, occurred_at
  ) VALUES (
    selected_trip_transition_id, selected_trip_id, offer.tenant_id, offer.facility_id,
    NULL, 'ASSIGNED', 'ASSIGN', 'USER', selected_dispatcher_user_id,
    'RESOURCES_ASSIGNED', selected_command_id, 1, effective_at
  );
  UPDATE dispatch.bookings
     SET status = 'ACTIVE', version = version + 2, updated_at = effective_at
   WHERE id = booking.id;
  UPDATE workforce.driver_profiles
     SET duty_status = 'RESERVED', version = version + 1, updated_at = effective_at
   WHERE id = selected_driver_id;
  UPDATE fleet.ambulances
     SET operational_status = 'RESERVED', version = version + 1, updated_at = effective_at
   WHERE id = selected_ambulance_id;
  PERFORM set_config('app.dispatch_command_booking_id', '', true);
  RETURN 'ACCEPTED';
EXCEPTION WHEN unique_violation THEN
  PERFORM set_config('app.dispatch_command_booking_id', '', true);
  RETURN 'RESOURCE_CONFLICT';
END;
$function$;

CREATE OR REPLACE FUNCTION dispatch.accepted_offer_outcomes(
  selected_offer_id uuid,
  selected_dispatcher_user_id uuid
)
RETURNS TABLE (
  id uuid,
  booking_id uuid,
  tenant_id uuid,
  facility_id uuid,
  status varchar,
  version integer,
  expires_at timestamptz,
  responded_at timestamptz,
  response_reason_code varchar,
  response_reason varchar,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT outcome.id, outcome.booking_id, outcome.tenant_id, outcome.facility_id,
         outcome.status, outcome.version, outcome.expires_at, outcome.responded_at,
         outcome.response_reason_code, outcome.response_reason,
         outcome.created_at, outcome.updated_at
    FROM dispatch.dispatch_offers accepted_offer
    JOIN dispatch.booking_assignments assignment
      ON assignment.offer_id = accepted_offer.id
    JOIN dispatch.dispatch_offers outcome
      ON outcome.booking_id = accepted_offer.booking_id
   WHERE accepted_offer.id = selected_offer_id
     AND accepted_offer.status = 'ACCEPTED'
     AND selected_dispatcher_user_id = governance.current_setting_uuid('app.user_id')
     AND assignment.dispatcher_user_id = selected_dispatcher_user_id
     AND governance.facility_is_in_scope(assignment.tenant_id, assignment.facility_id)
     AND outcome.status IN ('ACCEPTED','SUPERSEDED')
   ORDER BY outcome.created_at, outcome.id;
$function$;

CREATE OR REPLACE FUNCTION dispatch.resolve_offer(
  selected_offer_id uuid,
  expected_offer_version integer,
  selected_actor_user_id uuid,
  selected_status varchar,
  selected_reason_code varchar,
  selected_reason varchar
)
RETURNS varchar
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  offer dispatch.dispatch_offers%ROWTYPE;
  effective_at timestamptz := statement_timestamp();
BEGIN
  IF selected_actor_user_id <> governance.current_setting_uuid('app.user_id') OR
     selected_status NOT IN ('DECLINED','WITHDRAWN') THEN RETURN 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO offer FROM dispatch.dispatch_offers WHERE id = selected_offer_id FOR UPDATE;
  IF NOT FOUND OR NOT governance.facility_is_in_scope(offer.tenant_id, offer.facility_id) THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF offer.version <> expected_offer_version THEN RETURN 'STALE_VERSION'; END IF;
  IF offer.status <> 'PENDING' THEN RETURN 'OFFER_RESOLVED'; END IF;
  PERFORM set_config('app.dispatch_command_booking_id', offer.booking_id::text, true);
  UPDATE dispatch.dispatch_offers
     SET status = selected_status, version = version + 1, responded_at = effective_at,
          response_reason_code = selected_reason_code, response_reason = selected_reason,
          updated_at = effective_at
   WHERE id = offer.id;
  PERFORM set_config('app.dispatch_command_booking_id', '', true);
  RETURN selected_status;
END;
$function$;

CREATE OR REPLACE FUNCTION dispatch.expire_offer(
  selected_offer_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  offer dispatch.dispatch_offers%ROWTYPE;
  effective_at timestamptz := statement_timestamp();
BEGIN
  SELECT * INTO offer FROM dispatch.dispatch_offers WHERE id = selected_offer_id FOR UPDATE;
  IF NOT FOUND OR offer.status <> 'PENDING' OR offer.expires_at > effective_at OR
     offer.tenant_id <> governance.current_setting_uuid('app.tenant_id') THEN RETURN false; END IF;
  PERFORM set_config('app.dispatch_command_booking_id', offer.booking_id::text, true);
  UPDATE dispatch.dispatch_offers SET status = 'EXPIRED', version = version + 1,
    responded_at = effective_at, response_reason_code = 'DEADLINE_EXPIRED',
    updated_at = effective_at WHERE id = offer.id;
  PERFORM set_config('app.dispatch_command_booking_id', '', true);
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION dispatch.finish_search(
  selected_booking_id uuid,
  selected_transition_id uuid,
  selected_command_id varchar
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  booking dispatch.bookings%ROWTYPE;
  effective_at timestamptz := statement_timestamp();
BEGIN
  SELECT * INTO booking FROM dispatch.bookings WHERE id = selected_booking_id FOR UPDATE;
  IF NOT FOUND OR booking.status <> 'SEARCHING' OR booking.search_deadline > effective_at OR EXISTS (
    SELECT 1 FROM dispatch.booking_assignments assignment WHERE assignment.booking_id = booking.id
  ) THEN RETURN false; END IF;
  IF NOT dispatch.booking_is_in_tenant_scope(booking.id) AND
     current_setting('app.tenant_id', true) <> '' THEN RETURN false; END IF;
  PERFORM set_config('app.dispatch_command_booking_id', booking.id::text, true);
  UPDATE dispatch.dispatch_offers SET status = 'EXPIRED', version = version + 1,
    responded_at = effective_at, response_reason_code = 'SEARCH_DEADLINE_EXPIRED',
    updated_at = effective_at WHERE booking_id = booking.id AND status = 'PENDING';
  UPDATE dispatch.bookings SET status = 'UNFULFILLED', version = version + 1,
    updated_at = effective_at WHERE id = booking.id;
  INSERT INTO dispatch.booking_transitions (
    id, booking_id, from_status, to_status, actor_type, reason_code,
    command_id, aggregate_version, created_at
  ) VALUES (
    selected_transition_id, booking.id, 'SEARCHING', 'UNFULFILLED', 'SYSTEM_POLICY',
    'SEARCH_DEADLINE_EXPIRED', selected_command_id, booking.version + 1, effective_at
  );
  PERFORM set_config('app.dispatch_command_booking_id', '', true);
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION dispatch.transition_trip(
  selected_trip_id uuid,
  expected_trip_version integer,
  selected_transition_id uuid,
  selected_actor_user_id uuid,
  selected_command varchar,
  selected_command_id varchar,
  selected_reason_code varchar,
  selected_reason varchar,
  selected_pickup_odometer_meters bigint,
  selected_completion_odometer_meters bigint,
  selected_distance_meters bigint,
  selected_final_fare_minor bigint,
  selected_final_fare_currency char(3),
  selected_final_fare_provenance varchar
)
RETURNS varchar
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  booking dispatch.bookings%ROWTYPE;
  trip dispatch.trips%ROWTYPE;
  trip_booking_id uuid;
  target_status varchar(40);
  normal_scope boolean;
  effective_at timestamptz := statement_timestamp();
BEGIN
  IF selected_actor_user_id <> governance.current_setting_uuid('app.user_id') THEN
    RETURN 'NOT_AUTHORIZED';
  END IF;
  SELECT candidate.booking_id INTO trip_booking_id
    FROM dispatch.trips candidate
   WHERE candidate.id = selected_trip_id;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  SELECT * INTO booking FROM dispatch.bookings
   WHERE id = trip_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  SELECT * INTO trip FROM dispatch.trips
   WHERE id = selected_trip_id AND booking_id = booking.id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  normal_scope := governance.facility_is_in_scope(trip.tenant_id, trip.facility_id) AND (
    EXISTS (SELECT 1 FROM workforce.driver_profiles driver
      WHERE driver.id = trip.driver_id AND driver.user_id = selected_actor_user_id) OR
    governance.current_setting_uuid('app.tenant_id') = trip.tenant_id
  );
  IF NOT normal_scope THEN RETURN 'NOT_FOUND'; END IF;
  IF trip.version <> expected_trip_version THEN RETURN 'STALE_VERSION'; END IF;
  IF booking.status <> 'ACTIVE' THEN RETURN 'INVALID_TRANSITION'; END IF;

  target_status := CASE selected_command
    WHEN 'PREPARE' THEN CASE WHEN trip.status = 'ASSIGNED' THEN 'PREPARING_TO_DEPART' END
    WHEN 'DEPART_TO_PICKUP' THEN CASE WHEN trip.status IN ('ASSIGNED','PREPARING_TO_DEPART') THEN 'EN_ROUTE_TO_PICKUP' END
    WHEN 'ARRIVE_AT_PICKUP' THEN CASE WHEN trip.status = 'EN_ROUTE_TO_PICKUP' THEN 'ARRIVED_AT_PICKUP' END
    WHEN 'BOARD_PATIENT' THEN CASE WHEN trip.status = 'ARRIVED_AT_PICKUP' THEN 'PATIENT_ON_BOARD' END
    WHEN 'DEPART_TO_DESTINATION' THEN CASE WHEN trip.status = 'PATIENT_ON_BOARD' THEN 'EN_ROUTE_TO_DESTINATION' END
    WHEN 'ARRIVE_AT_DESTINATION' THEN CASE WHEN trip.status = 'EN_ROUTE_TO_DESTINATION' THEN 'ARRIVED_AT_DESTINATION' END
    WHEN 'COMPLETE' THEN CASE WHEN trip.status = 'ARRIVED_AT_DESTINATION' THEN 'COMPLETED' END
    ELSE NULL
  END;
  IF target_status IS NULL THEN RETURN 'INVALID_TRANSITION'; END IF;
  IF selected_command = 'COMPLETE' AND (
    selected_final_fare_minor IS NULL OR selected_final_fare_currency IS NULL OR
    selected_final_fare_currency <> 'NPR' OR selected_final_fare_provenance IS NULL OR
    selected_distance_meters IS NULL
  ) THEN RETURN 'COMPLETION_EVIDENCE_REQUIRED'; END IF;

  PERFORM set_config('app.trip_command_trip_id', trip.id::text, true);
  UPDATE dispatch.trips
     SET status = target_status, version = version + 1,
          started_at = CASE WHEN selected_command = 'DEPART_TO_PICKUP' THEN COALESCE(started_at, effective_at) ELSE started_at END,
          completed_at = CASE WHEN selected_command = 'COMPLETE' THEN effective_at ELSE completed_at END,
         pickup_odometer_meters = COALESCE(selected_pickup_odometer_meters, pickup_odometer_meters),
         completion_odometer_meters = CASE WHEN selected_command = 'COMPLETE' THEN selected_completion_odometer_meters ELSE completion_odometer_meters END,
         distance_meters = CASE WHEN selected_command = 'COMPLETE' THEN selected_distance_meters ELSE distance_meters END,
         final_fare_minor = CASE WHEN selected_command = 'COMPLETE' THEN selected_final_fare_minor ELSE final_fare_minor END,
         final_fare_currency = CASE WHEN selected_command = 'COMPLETE' THEN selected_final_fare_currency ELSE final_fare_currency END,
         final_fare_provenance = CASE WHEN selected_command = 'COMPLETE' THEN selected_final_fare_provenance ELSE final_fare_provenance END,
          updated_at = effective_at
   WHERE id = trip.id;
  PERFORM set_config('app.trip_command_trip_id', '', true);
  INSERT INTO dispatch.trip_transitions (
    id, trip_id, tenant_id, facility_id, from_status, to_status, command,
    actor_type, actor_id, reason_code, reason, command_id, aggregate_version, occurred_at
  ) VALUES (
    selected_transition_id, trip.id, trip.tenant_id, trip.facility_id, trip.status,
    target_status, selected_command, 'USER', selected_actor_user_id, selected_reason_code,
    selected_reason, selected_command_id, trip.version + 1, effective_at
  );

  IF selected_command = 'DEPART_TO_PICKUP' THEN
    UPDATE workforce.driver_profiles SET duty_status = 'ON_TRIP', version = version + 1,
      updated_at = effective_at WHERE id = trip.driver_id;
    UPDATE fleet.ambulances SET operational_status = 'DISPATCHED', version = version + 1,
      updated_at = effective_at WHERE id = trip.ambulance_id;
  ELSIF selected_command = 'COMPLETE' THEN
    UPDATE dispatch.booking_assignments SET released_at = effective_at,
      release_reason_code = 'TRIP_COMPLETED', version = version + 1
      WHERE id = trip.assignment_id AND released_at IS NULL;
    UPDATE workforce.driver_profiles SET duty_status = CASE
        WHEN verification_status = 'VERIFIED' AND account_status = 'ACTIVE' AND licence_expires_on >= effective_at::date
          THEN 'AVAILABLE' ELSE 'UNAVAILABLE' END,
      version = version + 1, updated_at = effective_at WHERE id = trip.driver_id;
    UPDATE fleet.ambulances SET operational_status = CASE
        WHEN compliance_status = 'APPROVED' AND readiness_status = 'READY' THEN 'AVAILABLE' ELSE 'OFFLINE' END,
      version = version + 1, updated_at = effective_at WHERE id = trip.ambulance_id;
    PERFORM set_config('app.dispatch_command_booking_id', trip.booking_id::text, true);
    INSERT INTO dispatch.booking_transitions (
      id, booking_id, from_status, to_status, actor_type, actor_id, reason_code,
      command_id, aggregate_version, created_at
    ) VALUES (
      gen_random_uuid(), booking.id, booking.status, 'COMPLETED', 'USER',
      selected_actor_user_id, 'TRIP_COMPLETED', selected_command_id,
      booking.version + 1, effective_at
    );
    UPDATE dispatch.bookings SET status = 'COMPLETED', version = version + 1,
      completed_at = effective_at, updated_at = effective_at WHERE id = booking.id;
    PERFORM set_config('app.dispatch_command_booking_id', '', true);
  END IF;
  RETURN target_status;
END;
$function$;

CREATE OR REPLACE FUNCTION dispatch.cancel_booking(
  selected_booking_id uuid,
  expected_booking_version integer,
  selected_cancellation_id uuid,
  selected_trip_transition_id uuid,
  selected_booking_transition_id uuid,
  selected_actor_user_id uuid,
  selected_actor_class varchar,
  selected_policy_code varchar,
  selected_policy_version varchar,
  selected_reason_code varchar,
  selected_reason varchar,
  selected_fee_minor bigint,
  selected_fee_currency char(3),
  selected_fee_waived boolean,
  selected_command_id varchar
)
RETURNS varchar
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  booking dispatch.bookings%ROWTYPE;
  assignment dispatch.booking_assignments%ROWTYPE;
  trip dispatch.trips%ROWTYPE;
  resolved_actor_class varchar(32);
  authorized boolean := false;
  authority_override boolean := false;
  effective_at timestamptz := statement_timestamp();
BEGIN
  resolved_actor_class := dispatch.cancellation_actor_class(selected_actor_user_id);
  IF resolved_actor_class IS NULL OR selected_actor_class IS DISTINCT FROM resolved_actor_class THEN
    RETURN 'NOT_AUTHORIZED';
  END IF;
  SELECT * INTO booking FROM dispatch.bookings WHERE id = selected_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF booking.version <> expected_booking_version THEN RETURN 'STALE_VERSION'; END IF;
  IF booking.status IN ('COMPLETED','CANCELLED','UNFULFILLED') THEN RETURN 'INVALID_TRANSITION'; END IF;
  SELECT * INTO assignment FROM dispatch.booking_assignments
    WHERE booking_id = booking.id FOR UPDATE;
  IF FOUND THEN SELECT * INTO trip FROM dispatch.trips WHERE assignment_id = assignment.id FOR UPDATE; END IF;

  IF resolved_actor_class = 'REQUESTER' THEN
    authorized := booking.requester_user_id = selected_actor_user_id;
  ELSIF resolved_actor_class IN ('PROVIDER','CREW') AND assignment.id IS NOT NULL THEN
    authorized := governance.facility_is_in_scope(assignment.tenant_id, assignment.facility_id);
    IF resolved_actor_class = 'CREW' THEN
      authorized := authorized AND EXISTS (
        SELECT 1 FROM workforce.driver_profiles driver
         WHERE driver.id = assignment.driver_id AND driver.user_id = selected_actor_user_id
      );
    END IF;
  ELSIF resolved_actor_class = 'AUTHORITY' AND assignment.id IS NOT NULL THEN
    authority_override := access_control.authority_allows_facility(
      'dispatch.override','dispatch',assignment.tenant_id,assignment.facility_id,effective_at
    );
    authorized := authority_override;
  END IF;
  IF NOT authorized THEN RETURN 'NOT_FOUND'; END IF;
  IF trip.id IS NOT NULL AND trip.status IN ('PATIENT_ON_BOARD','EN_ROUTE_TO_DESTINATION','ARRIVED_AT_DESTINATION')
     AND NOT authority_override THEN RETURN 'OVERRIDE_REQUIRED'; END IF;

  IF trip.id IS NOT NULL THEN
    PERFORM set_config('app.trip_command_trip_id', trip.id::text, true);
    UPDATE dispatch.trips SET status = 'CANCELLED', version = version + 1,
      cancelled_at = effective_at, updated_at = effective_at WHERE id = trip.id;
    PERFORM set_config('app.trip_command_trip_id', '', true);
    INSERT INTO dispatch.trip_transitions (
      id, trip_id, tenant_id, facility_id, from_status, to_status, command,
      actor_type, actor_id, reason_code, reason, command_id, aggregate_version, occurred_at
    ) VALUES (
      selected_trip_transition_id, trip.id, trip.tenant_id, trip.facility_id, trip.status,
      'CANCELLED', 'CANCEL', 'USER', selected_actor_user_id, selected_reason_code,
      selected_reason, selected_command_id, trip.version + 1, effective_at
    );
    UPDATE dispatch.booking_assignments SET released_at = effective_at,
      release_reason_code = 'TRIP_CANCELLED', version = version + 1
      WHERE id = assignment.id AND released_at IS NULL;
    UPDATE workforce.driver_profiles SET duty_status = CASE
        WHEN verification_status = 'VERIFIED' AND account_status = 'ACTIVE' AND licence_expires_on >= effective_at::date
          THEN 'AVAILABLE' ELSE 'UNAVAILABLE' END,
      version = version + 1, updated_at = effective_at WHERE id = assignment.driver_id;
    UPDATE fleet.ambulances SET operational_status = CASE
        WHEN compliance_status = 'APPROVED' AND readiness_status = 'READY' THEN 'AVAILABLE' ELSE 'OFFLINE' END,
      version = version + 1, updated_at = effective_at WHERE id = assignment.ambulance_id;
  END IF;

  PERFORM set_config('app.dispatch_command_booking_id', booking.id::text, true);
  UPDATE dispatch.dispatch_offers SET status = 'WITHDRAWN', version = version + 1,
    responded_at = effective_at, response_reason_code = 'BOOKING_CANCELLED',
    updated_at = effective_at WHERE booking_id = booking.id AND status = 'PENDING';
  UPDATE dispatch.bookings SET status = 'CANCELLED', version = version + 1,
    cancelled_at = effective_at, updated_at = effective_at WHERE id = booking.id;
  INSERT INTO dispatch.booking_transitions (
    id, booking_id, from_status, to_status, actor_type, actor_id, reason_code, reason,
    command_id, aggregate_version, created_at
  ) VALUES (
    selected_booking_transition_id, booking.id, booking.status, 'CANCELLED', 'USER',
    selected_actor_user_id, selected_reason_code, selected_reason, selected_command_id,
    booking.version + 1, effective_at
  );
  PERFORM set_config('app.dispatch_command_booking_id', '', true);
  INSERT INTO dispatch.cancellations (
    id, booking_id, trip_id, tenant_id, facility_id, actor_class, actor_user_id,
    policy_code, policy_version, reason_code, reason, fee_minor, fee_currency,
    fee_waived, lifecycle_point, created_at
  ) VALUES (
    selected_cancellation_id, booking.id, trip.id,
    CASE WHEN resolved_actor_class = 'REQUESTER' THEN NULL ELSE assignment.tenant_id END,
    CASE WHEN resolved_actor_class = 'REQUESTER' THEN NULL ELSE assignment.facility_id END,
    resolved_actor_class, selected_actor_user_id, selected_policy_code, selected_policy_version,
    selected_reason_code, selected_reason, selected_fee_minor, selected_fee_currency,
    selected_fee_waived, COALESCE(trip.status, booking.status), effective_at
  );
  RETURN 'CANCELLED';
END;
$function$;

CREATE OR REPLACE FUNCTION tracking.ingest_location_point(
  selected_id uuid,
  selected_trip_id uuid,
  selected_source_device_id uuid,
  selected_point_id uuid,
  selected_sequence bigint,
  selected_latitude numeric,
  selected_longitude numeric,
  selected_accuracy_meters numeric,
  selected_heading_degrees numeric,
  selected_speed_meters_per_second numeric,
  selected_quality varchar,
  selected_captured_at timestamptz
)
RETURNS varchar
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  trip dispatch.trips%ROWTYPE;
  inserted_id uuid;
  latest_source_sequence bigint;
  latest_captured_at timestamptz;
  effective_at timestamptz := statement_timestamp();
BEGIN
  SELECT * INTO trip FROM dispatch.trips WHERE id = selected_trip_id FOR UPDATE;
  IF NOT FOUND OR trip.status IN ('COMPLETED','CANCELLED') THEN RETURN 'TRIP_NOT_ACTIVE'; END IF;
  IF NOT governance.facility_is_in_scope(trip.tenant_id, trip.facility_id) OR NOT (
    EXISTS (
      SELECT 1 FROM workforce.driver_profiles driver
       WHERE driver.id = trip.driver_id
         AND driver.user_id = governance.current_setting_uuid('app.user_id')
         AND selected_source_device_id = driver.user_id
    ) OR EXISTS (
      SELECT 1 FROM fleet.device_bindings binding
       WHERE binding.id = selected_source_device_id
         AND binding.tenant_id = trip.tenant_id
         AND binding.facility_id = trip.facility_id
         AND binding.ambulance_id = trip.ambulance_id
         AND binding.status = 'ACTIVE'
    )
  ) THEN RETURN 'NOT_AUTHORIZED'; END IF;
  IF selected_sequence <= 0 OR selected_latitude NOT BETWEEN -90 AND 90 OR
     selected_longitude NOT BETWEEN -180 AND 180 OR selected_accuracy_meters NOT BETWEEN 0 AND 500 OR
     selected_captured_at < effective_at - interval '24 hours' OR
     selected_captured_at > effective_at + interval '5 minutes' OR
     selected_quality NOT IN ('GOOD','REDUCED','POOR') THEN RETURN 'INVALID_POINT'; END IF;
  IF EXISTS (
    SELECT 1
      FROM tracking.location_points point
     WHERE point.trip_id = trip.id
       AND point.source_device_id = selected_source_device_id
       AND (point.point_id = selected_point_id OR point.sequence = selected_sequence)
  ) THEN RETURN 'DUPLICATE'; END IF;
  SELECT max(point.sequence) INTO latest_source_sequence
    FROM tracking.location_points point
   WHERE point.trip_id = trip.id
     AND point.source_device_id = selected_source_device_id;
  IF latest_source_sequence IS NOT NULL AND selected_sequence <= latest_source_sequence THEN
    RETURN 'STALE_SEQUENCE';
  END IF;
  SELECT state.last_captured_at INTO latest_captured_at
    FROM tracking.trip_tracking_state state
   WHERE state.trip_id = trip.id
   FOR UPDATE;
  IF latest_captured_at IS NOT NULL AND selected_captured_at < latest_captured_at THEN
    RETURN 'STALE_CAPTURE';
  END IF;
  INSERT INTO tracking.location_points (
    id, trip_id, tenant_id, facility_id, source_device_id, point_id, sequence,
    latitude, longitude, accuracy_meters, heading_degrees, speed_meters_per_second,
    quality, captured_at, received_at
  ) VALUES (
    selected_id, trip.id, trip.tenant_id, trip.facility_id, selected_source_device_id,
    selected_point_id, selected_sequence, selected_latitude, selected_longitude,
    selected_accuracy_meters, selected_heading_degrees, selected_speed_meters_per_second,
    selected_quality, selected_captured_at, effective_at
  ) ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NULL THEN RETURN 'DUPLICATE'; END IF;
  INSERT INTO tracking.trip_tracking_state (
    trip_id, tenant_id, facility_id, last_location_point_id, last_sequence,
    last_captured_at, last_received_at, source_quality, updated_at
  ) VALUES (
    trip.id, trip.tenant_id, trip.facility_id, inserted_id, selected_sequence,
    selected_captured_at, effective_at, selected_quality, effective_at
  ) ON CONFLICT (trip_id) DO UPDATE SET
    last_location_point_id = EXCLUDED.last_location_point_id,
    last_sequence = EXCLUDED.last_sequence,
    last_captured_at = EXCLUDED.last_captured_at,
    last_received_at = EXCLUDED.last_received_at,
    source_quality = EXCLUDED.source_quality,
    version = tracking.trip_tracking_state.version + 1,
    updated_at = EXCLUDED.updated_at;
  RETURN 'ACCEPTED';
END;
$function$;

CREATE OR REPLACE FUNCTION tracking.principal_can_read_trip(selected_trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM dispatch.trips trip
     WHERE trip.id = selected_trip_id
       AND (
         trip.requester_user_id = governance.current_setting_uuid('app.user_id') OR
         governance.facility_is_in_scope(trip.tenant_id, trip.facility_id) OR
         dispatch.authority_allows_booking(
           'tracking.read','tracking',trip.booking_id,statement_timestamp()
         )
       )
  );
$function$;

CREATE OR REPLACE FUNCTION safety.create_incident(
  selected_incident_id uuid,
  selected_event_id uuid,
  selected_trip_id uuid,
  selected_booking_id uuid,
  selected_tenant_id uuid,
  selected_facility_id uuid,
  selected_incident_type varchar,
  selected_severity varchar,
  selected_details_ciphertext bytea,
  selected_details_nonce bytea,
  selected_details_tag bytea,
  selected_details_key_version varchar
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  creator_id uuid := governance.current_setting_uuid('app.user_id');
  effective_at timestamptz := statement_timestamp();
  booking dispatch.bookings%ROWTYPE;
  trip dispatch.trips%ROWTYPE;
  trip_booking_id uuid;
BEGIN
  IF creator_id IS NULL THEN RETURN false; END IF;
  IF selected_trip_id IS NULL THEN
    IF selected_booking_id IS NOT NULL OR selected_tenant_id IS NOT NULL OR
       selected_facility_id IS NOT NULL THEN RETURN false; END IF;
  ELSE
    IF selected_booking_id IS NULL OR selected_tenant_id IS NULL OR
       selected_facility_id IS NULL THEN RETURN false; END IF;
    SELECT candidate.booking_id INTO trip_booking_id
      FROM dispatch.trips candidate
     WHERE candidate.id = selected_trip_id;
    IF NOT FOUND OR trip_booking_id <> selected_booking_id THEN RETURN false; END IF;
    SELECT * INTO booking FROM dispatch.bookings
     WHERE id = trip_booking_id FOR UPDATE;
    IF NOT FOUND OR booking.status <> 'ACTIVE' THEN RETURN false; END IF;
    SELECT * INTO trip FROM dispatch.trips
     WHERE id = selected_trip_id AND booking_id = booking.id
       AND tenant_id = selected_tenant_id AND facility_id = selected_facility_id
     FOR UPDATE;
    IF NOT FOUND OR trip.status IN ('COMPLETED','CANCELLED') OR NOT (
      trip.requester_user_id = creator_id OR
      governance.facility_is_in_scope(trip.tenant_id, trip.facility_id)
    ) THEN RETURN false; END IF;
  END IF;
  INSERT INTO safety.safety_incidents (
    id, creator_user_id, trip_id, booking_id, tenant_id, facility_id,
    incident_type, severity, status, escalation_tier, details_ciphertext,
    details_nonce, details_tag, details_key_version, version, created_at, updated_at
  ) VALUES (
    selected_incident_id, creator_id, selected_trip_id, selected_booking_id,
    selected_tenant_id, selected_facility_id, selected_incident_type,
    selected_severity, 'OPEN', 0, selected_details_ciphertext, selected_details_nonce,
    selected_details_tag, selected_details_key_version, 1, effective_at, effective_at
  );
  INSERT INTO safety.safety_incident_events (
    id, incident_id, event_type, actor_type, actor_id, escalation_tier,
    outcome_code, aggregate_version, created_at
  ) VALUES (
    selected_event_id, selected_incident_id, 'CREATED', 'USER', creator_id, 0,
    'INCIDENT_CREATED', 1, effective_at
  );
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION safety.transition_incident(
  selected_incident_id uuid,
  expected_version integer,
  selected_event_id uuid,
  selected_actor_user_id uuid,
  selected_action varchar,
  selected_target_tier integer,
  selected_outcome_code varchar,
  selected_reason varchar
)
RETURNS varchar
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  incident safety.safety_incidents%ROWTYPE;
  target_status varchar(24);
  target_tier integer;
  effective_at timestamptz := statement_timestamp();
BEGIN
  IF selected_actor_user_id <> governance.current_setting_uuid('app.user_id') THEN RETURN 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO incident FROM safety.safety_incidents WHERE id = selected_incident_id FOR UPDATE;
  IF NOT FOUND OR incident.tenant_id IS NULL OR
     NOT governance.facility_is_in_scope(incident.tenant_id, incident.facility_id) THEN RETURN 'NOT_FOUND'; END IF;
  IF incident.version <> expected_version THEN RETURN 'STALE_VERSION'; END IF;
  IF incident.status = 'RESOLVED' THEN RETURN 'INVALID_TRANSITION'; END IF;
  target_status := CASE selected_action
    WHEN 'ACKNOWLEDGE' THEN CASE WHEN incident.status IN ('OPEN','ESCALATED') THEN 'ACKNOWLEDGED' END
    WHEN 'ESCALATE' THEN CASE WHEN incident.status IN ('OPEN','ACKNOWLEDGED','ESCALATED') THEN 'ESCALATED' END
    WHEN 'RESOLVE' THEN 'RESOLVED'
    ELSE NULL
  END;
  IF target_status IS NULL THEN RETURN 'INVALID_TRANSITION'; END IF;
  target_tier := CASE WHEN selected_action = 'ESCALATE' THEN selected_target_tier ELSE incident.escalation_tier END;
  IF target_tier IS NULL OR target_tier < incident.escalation_tier OR target_tier > 5 OR
     (selected_action = 'ESCALATE' AND target_tier <= incident.escalation_tier) THEN
    RETURN 'INVALID_ESCALATION_TIER';
  END IF;
  UPDATE safety.safety_incidents SET
    status = target_status, escalation_tier = target_tier, version = version + 1,
    acknowledged_by_user_id = COALESCE(acknowledged_by_user_id, selected_actor_user_id),
    acknowledged_at = COALESCE(acknowledged_at, effective_at),
    resolved_by_user_id = CASE WHEN selected_action = 'RESOLVE' THEN selected_actor_user_id ELSE NULL END,
    resolved_at = CASE WHEN selected_action = 'RESOLVE' THEN effective_at ELSE NULL END,
    resolution_code = CASE WHEN selected_action = 'RESOLVE' THEN selected_outcome_code ELSE NULL END,
    updated_at = effective_at
   WHERE id = incident.id;
  INSERT INTO safety.safety_incident_events (
    id, incident_id, event_type, actor_type, actor_id, escalation_tier,
    outcome_code, reason, aggregate_version, created_at
  ) VALUES (
    selected_event_id, incident.id,
    CASE selected_action WHEN 'ACKNOWLEDGE' THEN 'ACKNOWLEDGED' WHEN 'ESCALATE' THEN 'ESCALATED' ELSE 'RESOLVED' END,
    'USER', selected_actor_user_id, target_tier, selected_outcome_code, selected_reason,
    incident.version + 1, effective_at
  );
  RETURN target_status;
END;
$function$;

CREATE OR REPLACE FUNCTION safety.escalate_unacknowledged(
  selected_incident_id uuid,
  expected_version integer,
  expected_tier integer,
  selected_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  incident safety.safety_incidents%ROWTYPE;
  effective_at timestamptz := statement_timestamp();
BEGIN
  SELECT * INTO incident FROM safety.safety_incidents
   WHERE id = selected_incident_id FOR UPDATE;
  IF NOT FOUND OR incident.version <> expected_version OR
     incident.escalation_tier <> expected_tier OR expected_tier >= 5 OR
     incident.status NOT IN ('OPEN','ESCALATED') OR
     incident.acknowledged_at IS NOT NULL OR
     (incident.tenant_id IS NOT NULL AND
       incident.tenant_id <> governance.current_setting_uuid('app.tenant_id')) THEN
    RETURN false;
  END IF;
  UPDATE safety.safety_incidents SET status = 'ESCALATED',
    escalation_tier = escalation_tier + 1, version = version + 1,
    updated_at = effective_at WHERE id = incident.id;
  INSERT INTO safety.safety_incident_events (
    id, incident_id, event_type, actor_type, escalation_tier,
    outcome_code, aggregate_version, created_at
  ) VALUES (
    selected_event_id, incident.id, 'ESCALATED', 'SYSTEM_POLICY', expected_tier + 1,
    'UNACKNOWLEDGED_DEADLINE', incident.version + 1, effective_at
  );
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION safety.principal_can_write_incident_delivery(
  selected_incident_id uuid,
  selected_tenant_id uuid,
  selected_facility_id uuid,
  selected_actor_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT selected_actor_id IS NOT NULL AND
    selected_actor_id = governance.current_setting_uuid('app.user_id') AND
    EXISTS (
      SELECT 1 FROM safety.safety_incidents incident
       WHERE incident.id = selected_incident_id
         AND incident.creator_user_id = selected_actor_id
         AND incident.tenant_id IS NOT DISTINCT FROM selected_tenant_id
         AND incident.facility_id IS NOT DISTINCT FROM selected_facility_id
    );
$function$;

ALTER TABLE dispatch.service_coverage_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch.service_coverage_areas FORCE ROW LEVEL SECURITY;
CREATE POLICY service_coverage_tenant_policy ON dispatch.service_coverage_areas TO PUBLIC
  USING (governance.facility_is_in_scope(tenant_id, facility_id))
  WITH CHECK (governance.facility_is_in_scope(tenant_id, facility_id));

ALTER TABLE dispatch.fare_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch.fare_quotes FORCE ROW LEVEL SECURITY;
CREATE POLICY fare_quotes_self_policy ON dispatch.fare_quotes TO PUBLIC
  USING (requester_user_id = governance.current_setting_uuid('app.user_id'))
  WITH CHECK (requester_user_id = governance.current_setting_uuid('app.user_id'));

ALTER TABLE dispatch.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch.bookings FORCE ROW LEVEL SECURITY;
CREATE POLICY bookings_self_policy ON dispatch.bookings TO PUBLIC
  USING (requester_user_id = governance.current_setting_uuid('app.user_id'))
  WITH CHECK (requester_user_id = governance.current_setting_uuid('app.user_id'));
CREATE POLICY bookings_tenant_select_policy ON dispatch.bookings FOR SELECT TO PUBLIC
  USING (dispatch.booking_is_in_tenant_scope(id));
CREATE POLICY bookings_authority_select_policy ON dispatch.bookings FOR SELECT TO PUBLIC
  USING (dispatch.authority_allows_booking('booking.read','booking',id,statement_timestamp()));

ALTER TABLE dispatch.booking_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch.booking_transitions FORCE ROW LEVEL SECURITY;
CREATE POLICY booking_transitions_scope_policy ON dispatch.booking_transitions FOR SELECT TO PUBLIC
  USING (
    dispatch.user_is_booking_requester(booking_id,governance.current_setting_uuid('app.user_id')) OR
    dispatch.booking_is_in_tenant_scope(booking_id) OR
    dispatch.authority_allows_booking('booking.read','booking',booking_id,statement_timestamp())
  );
CREATE POLICY booking_transitions_insert_policy ON dispatch.booking_transitions FOR INSERT TO PUBLIC
  WITH CHECK (
    dispatch.user_is_booking_requester(booking_id,governance.current_setting_uuid('app.user_id')) OR
    dispatch.booking_is_in_tenant_scope(booking_id)
  );

ALTER TABLE dispatch.dispatch_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch.dispatch_offers FORCE ROW LEVEL SECURITY;
CREATE POLICY dispatch_offers_tenant_policy ON dispatch.dispatch_offers TO PUBLIC
  USING (governance.facility_is_in_scope(tenant_id, facility_id))
  WITH CHECK (governance.facility_is_in_scope(tenant_id, facility_id));
CREATE POLICY dispatch_offers_authority_select_policy ON dispatch.dispatch_offers FOR SELECT TO PUBLIC
  USING (dispatch.authority_allows_booking('booking.read','booking',booking_id,statement_timestamp()));

ALTER TABLE dispatch.booking_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch.booking_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY booking_assignments_tenant_policy ON dispatch.booking_assignments TO PUBLIC
  USING (governance.facility_is_in_scope(tenant_id, facility_id))
  WITH CHECK (governance.facility_is_in_scope(tenant_id, facility_id));
CREATE POLICY booking_assignments_requester_select_policy ON dispatch.booking_assignments FOR SELECT TO PUBLIC
  USING (dispatch.user_is_booking_requester(booking_id,governance.current_setting_uuid('app.user_id')));
CREATE POLICY booking_assignments_authority_select_policy ON dispatch.booking_assignments FOR SELECT TO PUBLIC
  USING (dispatch.authority_allows_booking('booking.read','booking',booking_id,statement_timestamp()));

ALTER TABLE dispatch.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch.trips FORCE ROW LEVEL SECURITY;
CREATE POLICY trips_tenant_policy ON dispatch.trips TO PUBLIC
  USING (governance.facility_is_in_scope(tenant_id, facility_id))
  WITH CHECK (governance.facility_is_in_scope(tenant_id, facility_id));
CREATE POLICY trips_requester_select_policy ON dispatch.trips FOR SELECT TO PUBLIC
  USING (requester_user_id = governance.current_setting_uuid('app.user_id'));
CREATE POLICY trips_authority_select_policy ON dispatch.trips FOR SELECT TO PUBLIC
  USING (dispatch.authority_allows_booking('trip.read','trip',booking_id,statement_timestamp()));

ALTER TABLE dispatch.trip_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch.trip_transitions FORCE ROW LEVEL SECURITY;
CREATE POLICY trip_transitions_scope_policy ON dispatch.trip_transitions TO PUBLIC
  USING (
    governance.facility_is_in_scope(tenant_id, facility_id) OR
    EXISTS (SELECT 1 FROM dispatch.trips trip WHERE trip.id = trip_transitions.trip_id) OR
    dispatch.authority_allows_booking('trip.read','trip',
      (SELECT trip.booking_id FROM dispatch.trips trip WHERE trip.id = trip_transitions.trip_id),
      statement_timestamp())
  )
  WITH CHECK (governance.facility_is_in_scope(tenant_id, facility_id));

ALTER TABLE dispatch.cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch.cancellations FORCE ROW LEVEL SECURITY;
CREATE POLICY cancellations_scope_policy ON dispatch.cancellations FOR SELECT TO PUBLIC
  USING (
    dispatch.user_is_booking_requester(booking_id,governance.current_setting_uuid('app.user_id')) OR
    (tenant_id IS NOT NULL AND governance.facility_is_in_scope(tenant_id, facility_id)) OR
    dispatch.authority_allows_booking('booking.read','booking',booking_id,statement_timestamp())
  );

ALTER TABLE tracking.location_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking.location_points FORCE ROW LEVEL SECURITY;
CREATE POLICY location_points_scope_policy ON tracking.location_points FOR SELECT TO PUBLIC
  USING (tracking.principal_can_read_trip(trip_id));

ALTER TABLE tracking.trip_tracking_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking.trip_tracking_state FORCE ROW LEVEL SECURITY;
CREATE POLICY trip_tracking_state_scope_policy ON tracking.trip_tracking_state FOR SELECT TO PUBLIC
  USING (tracking.principal_can_read_trip(trip_id));

ALTER TABLE safety.safety_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety.safety_incidents FORCE ROW LEVEL SECURITY;
CREATE POLICY safety_incidents_creator_policy ON safety.safety_incidents TO PUBLIC
  USING (creator_user_id = governance.current_setting_uuid('app.user_id'))
  WITH CHECK (
    creator_user_id = governance.current_setting_uuid('app.user_id') AND
    (
      trip_id IS NULL OR EXISTS (
        SELECT 1 FROM dispatch.trips trip
         WHERE trip.id = safety_incidents.trip_id
           AND trip.booking_id = safety_incidents.booking_id
           AND trip.tenant_id = safety_incidents.tenant_id
           AND trip.facility_id = safety_incidents.facility_id
      )
    )
  );
CREATE POLICY safety_incidents_tenant_policy ON safety.safety_incidents TO PUBLIC
  USING (tenant_id IS NOT NULL AND governance.facility_is_in_scope(tenant_id, facility_id))
  WITH CHECK (tenant_id IS NOT NULL AND governance.facility_is_in_scope(tenant_id, facility_id));
CREATE POLICY safety_incidents_authority_select_policy ON safety.safety_incidents FOR SELECT TO PUBLIC
  USING (
    booking_id IS NOT NULL AND
    dispatch.authority_allows_booking('safety.incident.read','safety_incident',booking_id,statement_timestamp())
  );

ALTER TABLE safety.safety_incident_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety.safety_incident_events FORCE ROW LEVEL SECURITY;
CREATE POLICY safety_incident_events_scope_policy ON safety.safety_incident_events TO PUBLIC
  USING (EXISTS (SELECT 1 FROM safety.safety_incidents incident
    WHERE incident.id = safety_incident_events.incident_id))
  WITH CHECK (EXISTS (SELECT 1 FROM safety.safety_incidents incident
    WHERE incident.id = safety_incident_events.incident_id));

CREATE POLICY audit_events_core_requester_select_policy ON governance.audit_events
  FOR SELECT TO PUBLIC
  USING (
    tenant_id IS NOT NULL AND actor_type = 'USER' AND
    actor_id = governance.current_setting_uuid('app.user_id') AND
    authority_grant_id IS NULL AND (
      (
        action = 'dispatch.booking.cancel' AND resource_type = 'booking' AND
        dispatch.principal_can_write_booking_delivery(
          resource_id,tenant_id,NULL,actor_id
        )
      ) OR (
        action = 'safety.incident.create' AND resource_type = 'safety_incident' AND
        safety.principal_can_write_incident_delivery(
          resource_id,tenant_id,
          (SELECT incident.facility_id FROM safety.safety_incidents incident
            WHERE incident.id = audit_events.resource_id),
          actor_id
        )
      )
    )
  );
CREATE POLICY audit_events_core_requester_insert_policy ON governance.audit_events
  FOR INSERT TO PUBLIC
  WITH CHECK (
    tenant_id IS NOT NULL AND actor_type = 'USER' AND
    actor_id = governance.current_setting_uuid('app.user_id') AND
    authority_grant_id IS NULL AND (
      (
        action = 'dispatch.booking.cancel' AND resource_type = 'booking' AND
        dispatch.principal_can_write_booking_delivery(
          resource_id,tenant_id,NULL,actor_id
        )
      ) OR (
        action = 'safety.incident.create' AND resource_type = 'safety_incident' AND
        safety.principal_can_write_incident_delivery(
          resource_id,tenant_id,
          (SELECT incident.facility_id FROM safety.safety_incidents incident
            WHERE incident.id = audit_events.resource_id),
          actor_id
        )
      )
    )
  );

DROP POLICY event_stream_sequences_scoped_policy ON governance.event_stream_sequences;
CREATE POLICY event_stream_sequences_scoped_policy ON governance.event_stream_sequences TO PUBLIC
  USING (
    tenant_id = governance.current_setting_uuid('app.tenant_id') OR
    (tenant_id IS NULL AND stream_type NOT IN ('bookingDispatch','trip','safetyIncident') AND
      governance.current_setting_uuid('app.user_id') IS NOT NULL) OR
    (tenant_id IS NOT NULL AND access_control.authority_allows_tenant(
      'document.review','document',tenant_id,statement_timestamp()
    )) OR
    (stream_type = 'bookingDispatch' AND dispatch.booking_is_in_tenant_scope(stream_id)) OR
    (stream_type = 'bookingDispatch' AND dispatch.principal_can_write_booking_delivery(
      stream_id,tenant_id,NULL,governance.current_setting_uuid('app.user_id')
    )) OR
    (stream_type = 'bookingDispatch' AND EXISTS (
      SELECT 1 FROM dispatch.dispatch_offers offer
       WHERE offer.booking_id = event_stream_sequences.stream_id
         AND offer.tenant_id = event_stream_sequences.tenant_id
         AND dispatch.principal_can_write_booking_delivery(
           offer.booking_id,offer.tenant_id,offer.facility_id,
           governance.current_setting_uuid('app.user_id')
         )
    )) OR
    (stream_type = 'trip' AND dispatch.principal_can_write_trip_delivery(
      stream_id,tenant_id,NULL,governance.current_setting_uuid('app.user_id')
    )) OR
    (stream_type = 'safetyIncident' AND safety.principal_can_write_incident_delivery(
      stream_id,tenant_id,
      (SELECT incident.facility_id FROM safety.safety_incidents incident
        WHERE incident.id = event_stream_sequences.stream_id),
      governance.current_setting_uuid('app.user_id')
    ))
  )
  WITH CHECK (
    tenant_id = governance.current_setting_uuid('app.tenant_id') OR
    (tenant_id IS NULL AND stream_type NOT IN ('bookingDispatch','trip','safetyIncident') AND
      governance.current_setting_uuid('app.user_id') IS NOT NULL) OR
    (tenant_id IS NOT NULL AND access_control.authority_allows_tenant(
      'document.review','document',tenant_id,statement_timestamp()
    )) OR
    (stream_type = 'bookingDispatch' AND dispatch.booking_is_in_tenant_scope(stream_id)) OR
    (stream_type = 'bookingDispatch' AND dispatch.principal_can_write_booking_delivery(
      stream_id,tenant_id,NULL,governance.current_setting_uuid('app.user_id')
    )) OR
    (stream_type = 'bookingDispatch' AND EXISTS (
      SELECT 1 FROM dispatch.dispatch_offers offer
       WHERE offer.booking_id = event_stream_sequences.stream_id
         AND offer.tenant_id = event_stream_sequences.tenant_id
         AND dispatch.principal_can_write_booking_delivery(
           offer.booking_id,offer.tenant_id,offer.facility_id,
           governance.current_setting_uuid('app.user_id')
         )
    )) OR
    (stream_type = 'trip' AND dispatch.principal_can_write_trip_delivery(
      stream_id,tenant_id,NULL,governance.current_setting_uuid('app.user_id')
    )) OR
    (stream_type = 'safetyIncident' AND safety.principal_can_write_incident_delivery(
      stream_id,tenant_id,
      (SELECT incident.facility_id FROM safety.safety_incidents incident
        WHERE incident.id = event_stream_sequences.stream_id),
      governance.current_setting_uuid('app.user_id')
    ))
  );

DROP POLICY outbox_events_scoped_policy ON governance.outbox_events;
CREATE POLICY outbox_events_scoped_policy ON governance.outbox_events TO PUBLIC
  USING (
    (tenant_id IS NOT NULL AND tenant_id = governance.current_setting_uuid('app.tenant_id')) OR
    (tenant_id IS NULL AND stream_type NOT IN ('bookingDispatch','trip','safetyIncident') AND
      actor_type = 'USER' AND actor_id = governance.current_setting_uuid('app.user_id')) OR
    (
      actor_type = 'USER' AND actor_id = governance.current_setting_uuid('app.user_id') AND
      (
        (stream_type = 'bookingDispatch' AND dispatch.principal_can_write_booking_delivery(
          stream_id,tenant_id,facility_id,actor_id
        )) OR
        (aggregate_type = 'dispatchOffer' AND
          event_type IN ('dispatch.offer.accepted.v1','dispatch.offer.superseded.v1') AND
          dispatch.principal_can_write_offer_outcome_delivery(
             aggregate_id,stream_id,tenant_id,facility_id,actor_id
           )) OR
        (aggregate_type = 'trip' AND stream_type = 'trip' AND aggregate_id = stream_id AND
          event_type = 'trip.cancelled.v1' AND facility_id IS NOT NULL AND
          dispatch.principal_can_write_trip_delivery(
            aggregate_id,tenant_id,facility_id,actor_id
          )) OR
        (aggregate_type = 'safetyIncident' AND safety.principal_can_write_incident_delivery(
          aggregate_id,tenant_id,facility_id,actor_id
        ))
      )
    ) OR
    (tenant_id IS NOT NULL AND access_control.authority_allows_tenant(
      CASE WHEN aggregate_type IN ('booking','trip','safetyIncident') THEN 'trip.read' ELSE 'provider.review' END,
      CASE WHEN aggregate_type = 'safetyIncident' THEN 'safety_incident' ELSE aggregate_type END,
      tenant_id, statement_timestamp()
    ))
  )
  WITH CHECK (
    (tenant_id IS NOT NULL AND tenant_id = governance.current_setting_uuid('app.tenant_id')) OR
    (tenant_id IS NULL AND stream_type NOT IN ('bookingDispatch','trip','safetyIncident') AND
      actor_type = 'USER' AND actor_id = governance.current_setting_uuid('app.user_id')) OR
    (
      actor_type = 'USER' AND actor_id = governance.current_setting_uuid('app.user_id') AND
      (
        (stream_type = 'bookingDispatch' AND dispatch.principal_can_write_booking_delivery(
          stream_id,tenant_id,facility_id,actor_id
        )) OR
        (aggregate_type = 'dispatchOffer' AND
          event_type IN ('dispatch.offer.accepted.v1','dispatch.offer.superseded.v1') AND
          dispatch.principal_can_write_offer_outcome_delivery(
             aggregate_id,stream_id,tenant_id,facility_id,actor_id
           )) OR
        (aggregate_type = 'trip' AND stream_type = 'trip' AND aggregate_id = stream_id AND
          event_type = 'trip.cancelled.v1' AND facility_id IS NOT NULL AND
          dispatch.principal_can_write_trip_delivery(
            aggregate_id,tenant_id,facility_id,actor_id
          )) OR
        (aggregate_type = 'safetyIncident' AND safety.principal_can_write_incident_delivery(
          aggregate_id,tenant_id,facility_id,actor_id
        ))
      )
    ) OR
    (tenant_id IS NOT NULL AND access_control.authority_allows_tenant(
      CASE
        WHEN aggregate_type = 'documentObject' THEN 'document.review'
        WHEN aggregate_type IN ('booking','trip','safetyIncident') THEN 'trip.transition'
        ELSE 'provider.review'
      END,
      CASE WHEN aggregate_type = 'documentObject' THEN 'document'
           WHEN aggregate_type = 'safetyIncident' THEN 'safety_incident'
           ELSE aggregate_type END,
      tenant_id, statement_timestamp()
    ))
  );

DROP POLICY job_intents_principal_policy ON governance.job_intents;
CREATE POLICY job_intents_principal_policy ON governance.job_intents TO PUBLIC
  USING (
    tenant_id IS NULL AND
    job_type NOT LIKE 'dispatch.%' AND job_type NOT LIKE 'safety.%' AND
    resource_type NOT IN ('booking','dispatchOffer','trip','safetyIncident') AND
    requested_by_type = 'USER' AND
    requested_by_id = governance.current_setting_uuid('app.user_id')::text
  )
  WITH CHECK (
    tenant_id IS NULL AND
    job_type NOT LIKE 'dispatch.%' AND job_type NOT LIKE 'safety.%' AND
    resource_type NOT IN ('booking','dispatchOffer','trip','safetyIncident') AND
    requested_by_type = 'USER' AND
    requested_by_id = governance.current_setting_uuid('app.user_id')::text
  );

CREATE POLICY job_intents_dispatch_principal_policy ON governance.job_intents TO PUBLIC
  USING (
    requested_by_type = 'USER' AND
    requested_by_id = governance.current_setting_uuid('app.user_id')::text AND
    (
      (resource_type = 'booking' AND dispatch.principal_can_write_booking_delivery(
        resource_id,tenant_id,NULL,governance.current_setting_uuid('app.user_id')
      )) OR
      (resource_type = 'dispatchOffer' AND EXISTS (
        SELECT 1 FROM dispatch.dispatch_offers offer
         WHERE offer.id = job_intents.resource_id
           AND offer.tenant_id = job_intents.tenant_id
           AND dispatch.principal_can_write_booking_delivery(
             offer.booking_id,offer.tenant_id,offer.facility_id,
             governance.current_setting_uuid('app.user_id')
           )
      )) OR
      (resource_type = 'safetyIncident' AND safety.principal_can_write_incident_delivery(
        resource_id,tenant_id,
        (SELECT incident.facility_id FROM safety.safety_incidents incident
          WHERE incident.id = job_intents.resource_id),
        governance.current_setting_uuid('app.user_id')
      ))
    )
  )
  WITH CHECK (
    requested_by_type = 'USER' AND
    requested_by_id = governance.current_setting_uuid('app.user_id')::text AND
    (
      (resource_type = 'booking' AND dispatch.principal_can_write_booking_delivery(
        resource_id,tenant_id,NULL,governance.current_setting_uuid('app.user_id')
      )) OR
      (resource_type = 'dispatchOffer' AND EXISTS (
        SELECT 1 FROM dispatch.dispatch_offers offer
         WHERE offer.id = job_intents.resource_id
           AND offer.tenant_id = job_intents.tenant_id
           AND dispatch.principal_can_write_booking_delivery(
             offer.booking_id,offer.tenant_id,offer.facility_id,
             governance.current_setting_uuid('app.user_id')
           )
      )) OR
      (resource_type = 'safetyIncident' AND safety.principal_can_write_incident_delivery(
        resource_id,tenant_id,
        (SELECT incident.facility_id FROM safety.safety_incidents incident
          WHERE incident.id = job_intents.resource_id),
        governance.current_setting_uuid('app.user_id')
      ))
    )
  );

DO $worker_policies$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resq_worker') THEN
    EXECUTE 'CREATE POLICY bookings_worker_select_policy ON dispatch.bookings FOR SELECT TO resq_worker USING (true)';
    EXECUTE 'CREATE POLICY dispatch_offers_worker_select_policy ON dispatch.dispatch_offers FOR SELECT TO resq_worker USING (true)';
    EXECUTE 'CREATE POLICY trips_worker_select_policy ON dispatch.trips FOR SELECT TO resq_worker USING (true)';
    EXECUTE 'CREATE POLICY safety_incidents_worker_select_policy ON safety.safety_incidents FOR SELECT TO resq_worker USING (true)';
    EXECUTE 'CREATE POLICY event_stream_sequences_worker_policy ON governance.event_stream_sequences FOR ALL TO resq_worker USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY outbox_events_worker_policy ON governance.outbox_events FOR ALL TO resq_worker USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY job_intents_worker_policy ON governance.job_intents FOR ALL TO resq_worker USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY audit_events_worker_policy ON governance.audit_events FOR ALL TO resq_worker USING (true) WITH CHECK (true)';
  END IF;
END;
$worker_policies$;

REVOKE ALL ON ALL TABLES IN SCHEMA dispatch FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA tracking FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA safety FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA dispatch FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tracking FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA safety FROM PUBLIC;

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resq_application') THEN
    GRANT USAGE ON SCHEMA dispatch, tracking, safety TO resq_application;
    GRANT EXECUTE ON FUNCTION
      dispatch.find_service_coverage(varchar,numeric,numeric),
      dispatch.user_is_booking_requester(uuid,uuid),
      dispatch.cancellation_actor_class(uuid),
      dispatch.create_booking(uuid,varchar,uuid,uuid,uuid,varchar,varchar,varchar,numeric,numeric,numeric,numeric,bytea,bytea,bytea,varchar,jsonb,uuid,varchar,timestamptz),
      dispatch.start_booking_search(uuid,integer,uuid,varchar,uuid[],uuid[],timestamptz),
      dispatch.booking_is_in_tenant_scope(uuid),
      dispatch.principal_can_write_booking_delivery(uuid,uuid,uuid,uuid),
      dispatch.principal_can_write_trip_delivery(uuid,uuid,uuid,uuid),
      dispatch.principal_can_write_offer_outcome_delivery(uuid,uuid,uuid,uuid,uuid),
      dispatch.authority_allows_booking(varchar,varchar,uuid,timestamptz),
      dispatch.accept_offer(uuid,integer,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,varchar),
      dispatch.accepted_offer_outcomes(uuid,uuid),
      dispatch.resolve_offer(uuid,integer,uuid,varchar,varchar,varchar),
      dispatch.transition_trip(uuid,integer,uuid,uuid,varchar,varchar,varchar,varchar,bigint,bigint,bigint,bigint,char,varchar),
      dispatch.cancel_booking(uuid,integer,uuid,uuid,uuid,uuid,varchar,varchar,varchar,varchar,varchar,bigint,char,boolean,varchar),
      tracking.ingest_location_point(uuid,uuid,uuid,uuid,bigint,numeric,numeric,numeric,numeric,numeric,varchar,timestamptz),
      tracking.principal_can_read_trip(uuid),
      safety.create_incident(uuid,uuid,uuid,uuid,uuid,uuid,varchar,varchar,bytea,bytea,bytea,varchar),
      safety.transition_incident(uuid,integer,uuid,uuid,varchar,integer,varchar,varchar),
      safety.principal_can_write_incident_delivery(uuid,uuid,uuid,uuid)
      TO resq_application;
    GRANT SELECT, INSERT, UPDATE ON dispatch.service_coverage_areas TO resq_application;
    GRANT SELECT, INSERT ON dispatch.fare_quotes TO resq_application;
    GRANT SELECT ON dispatch.bookings, dispatch.booking_transitions,
      dispatch.dispatch_offers, dispatch.booking_assignments, dispatch.trips,
      dispatch.trip_transitions, dispatch.cancellations, tracking.location_points,
      tracking.trip_tracking_state, safety.safety_incidents,
      safety.safety_incident_events TO resq_application;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resq_worker') THEN
    GRANT USAGE ON SCHEMA dispatch, tracking, safety TO resq_worker;
    GRANT EXECUTE ON FUNCTION
      dispatch.user_is_booking_requester(uuid,uuid),
      dispatch.booking_is_in_tenant_scope(uuid),
      dispatch.authority_allows_booking(varchar,varchar,uuid,timestamptz),
      dispatch.expire_offer(uuid),
      dispatch.finish_search(uuid,uuid,varchar),
      safety.escalate_unacknowledged(uuid,integer,integer,uuid)
      TO resq_worker;
    GRANT SELECT ON dispatch.bookings, dispatch.dispatch_offers, dispatch.booking_assignments,
      dispatch.trips, safety.safety_incidents TO resq_worker;
  END IF;
END;
$roles$;
`;

export class CreateCoreDispatch1793664000004 implements MigrationInterface {
  readonly name = 'CreateCoreDispatch1793664000004';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(CORE_DISPATCH_SQL);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Production migrations are forward-only; use a reviewed compensating migration'),
    );
  }
}
