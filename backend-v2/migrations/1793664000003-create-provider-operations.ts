import type { MigrationInterface, QueryRunner } from 'typeorm';

export const PROVIDER_OPERATIONS_SQL = String.raw`
CREATE SCHEMA IF NOT EXISTS provider_registry;
CREATE SCHEMA IF NOT EXISTS workforce;
CREATE SCHEMA IF NOT EXISTS fleet;
CREATE SCHEMA IF NOT EXISTS documents;

REVOKE ALL ON SCHEMA provider_registry FROM PUBLIC;
REVOKE ALL ON SCHEMA workforce FROM PUBLIC;
REVOKE ALL ON SCHEMA fleet FROM PUBLIC;
REVOKE ALL ON SCHEMA documents FROM PUBLIC;

CREATE OR REPLACE FUNCTION governance.facility_is_in_scope(selected_tenant_id uuid, selected_facility_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT selected_tenant_id = governance.current_setting_uuid('app.tenant_id')
     AND (
       current_setting('app.access_scope_type', true) = 'TENANT' OR
       (
         current_setting('app.access_scope_type', true) = 'FACILITY_SET' AND
         selected_facility_id = ANY(governance.current_setting_uuid_array('app.facility_scope'))
       )
     );
$function$;

CREATE OR REPLACE FUNCTION access_control.authority_allows(
  required_permission varchar,
  required_resource varchar,
  selected_geographic_unit_id uuid,
  selected_tenant_id uuid,
  evaluated_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH RECURSIVE geography_chain AS (
    SELECT unit.id, unit.parent_id
      FROM geography.geographic_units unit
     WHERE unit.id = selected_geographic_unit_id
    UNION ALL
    SELECT parent.id, parent.parent_id
      FROM geography_chain child
      JOIN geography.geographic_units parent ON parent.id = child.parent_id
  )
  SELECT EXISTS (
    SELECT 1
      FROM access_control.authority_grants grant_record
      JOIN access_control.authority_grant_permissions permission
        ON permission.grant_id = grant_record.id
       AND permission.permission_code = required_permission
      JOIN access_control.authority_grant_resources resource
        ON resource.grant_id = grant_record.id
       AND resource.resource_class = required_resource
     WHERE grant_record.id = governance.current_setting_uuid('app.authority_grant_id')
       AND grant_record.subject_user_id = governance.current_setting_uuid('app.user_id')
       AND grant_record.status = 'ACTIVE'
       AND grant_record.valid_from <= evaluated_at
       AND grant_record.expires_at > evaluated_at
       AND access_control.authority_chain_is_active(grant_record.id, evaluated_at)
       AND (
         grant_record.national_scope OR EXISTS (
           SELECT 1
             FROM access_control.authority_grant_geographies allowed_geography
            WHERE allowed_geography.grant_id = grant_record.id
              AND allowed_geography.geographic_unit_id IN (SELECT id FROM geography_chain)
         )
       )
       AND (
         selected_tenant_id IS NULL OR
         NOT EXISTS (
           SELECT 1 FROM access_control.authority_grant_provider_exclusions excluded
            WHERE excluded.grant_id = grant_record.id AND excluded.tenant_id = selected_tenant_id
         )
       )
       AND (
         selected_tenant_id IS NULL OR
         NOT EXISTS (
           SELECT 1 FROM access_control.authority_grant_provider_inclusions included_shape
            WHERE included_shape.grant_id = grant_record.id
         ) OR EXISTS (
           SELECT 1 FROM access_control.authority_grant_provider_inclusions included
            WHERE included.grant_id = grant_record.id AND included.tenant_id = selected_tenant_id
         )
       )
  );
$function$;

CREATE OR REPLACE FUNCTION access_control.authority_allows_tenant(
  required_permission varchar,
  required_resource varchar,
  selected_tenant_id uuid,
  evaluated_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM tenancy.facilities facility
     WHERE facility.tenant_id = selected_tenant_id
       AND access_control.authority_allows(
         required_permission,
         required_resource,
         facility.geographic_unit_id,
         selected_tenant_id,
         evaluated_at
       )
  );
$function$;

CREATE OR REPLACE FUNCTION access_control.authority_allows_facility(
  required_permission varchar,
  required_resource varchar,
  selected_tenant_id uuid,
  selected_facility_id uuid,
  evaluated_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM tenancy.facilities facility
     WHERE facility.tenant_id = selected_tenant_id
       AND facility.id = selected_facility_id
       AND access_control.authority_allows(
         required_permission,
         required_resource,
         facility.geographic_unit_id,
         selected_tenant_id,
         evaluated_at
       )
  );
$function$;

CREATE POLICY provider_organizations_authority_select_policy
  ON tenancy.provider_organizations FOR SELECT TO PUBLIC
  USING (EXISTS (
    SELECT 1 FROM tenancy.facilities facility
     WHERE facility.tenant_id = provider_organizations.id
       AND access_control.authority_allows_facility(
         'provider.read','provider',facility.tenant_id,facility.id,statement_timestamp()
       )
  ));

CREATE POLICY facilities_authority_select_policy ON tenancy.facilities FOR SELECT TO PUBLIC
  USING (access_control.authority_allows_facility(
    'facility.read','facility',tenant_id,id,statement_timestamp()
  ));

CREATE OR REPLACE FUNCTION tenancy.facility_accepts_driver_application(
  selected_tenant_id uuid,
  selected_facility_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM tenancy.facilities facility
     WHERE facility.tenant_id = selected_tenant_id
       AND facility.id = selected_facility_id
       AND facility.operating_status = 'ACTIVE'
  );
$function$;

CREATE TABLE provider_registry.provider_applications (
  id uuid PRIMARY KEY,
  applicant_user_id uuid NOT NULL REFERENCES identity.users(id),
  legal_name varchar(256) NOT NULL,
  display_name varchar(160) NOT NULL,
  registration_number varchar(128) NOT NULL,
  geographic_unit_id uuid NOT NULL REFERENCES geography.geographic_units(id),
  facility_name varchar(256) NOT NULL,
  facility_type varchar(64) NOT NULL,
  public_phone varchar(32),
  status varchar(32) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  submitted_at timestamptz,
  decided_at timestamptz,
  tenant_id uuid REFERENCES tenancy.provider_organizations(id),
  facility_id uuid,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id),
  CONSTRAINT provider_application_status CHECK (
    status IN ('DRAFT','SUBMITTED','PROVINCE_REVIEW','NEEDS_INFORMATION',
      'PROVINCE_RECOMMENDED','PLATFORM_REVIEW','APPROVED','REJECTED','WITHDRAWN')
  ),
  CONSTRAINT provider_application_version CHECK (version > 0),
  CONSTRAINT provider_application_approval_shape CHECK (
    (status = 'APPROVED' AND tenant_id IS NOT NULL AND facility_id IS NOT NULL AND decided_at IS NOT NULL) OR
    (status IN ('REJECTED','WITHDRAWN') AND tenant_id IS NULL AND facility_id IS NULL AND decided_at IS NOT NULL) OR
    (status NOT IN ('APPROVED','REJECTED','WITHDRAWN') AND tenant_id IS NULL AND facility_id IS NULL AND decided_at IS NULL)
  ),
  CONSTRAINT provider_application_submission_shape CHECK (
    (status = 'DRAFT' AND submitted_at IS NULL) OR (status <> 'DRAFT' AND submitted_at IS NOT NULL)
  ),
  CONSTRAINT provider_application_time_order CHECK (
    updated_at >= created_at AND (submitted_at IS NULL OR submitted_at >= created_at) AND
    (decided_at IS NULL OR decided_at >= created_at)
  )
);
CREATE UNIQUE INDEX provider_application_active_registration_idx
  ON provider_registry.provider_applications (lower(registration_number))
  WHERE status NOT IN ('REJECTED','WITHDRAWN');
CREATE INDEX provider_application_review_queue_idx
  ON provider_registry.provider_applications (status, geographic_unit_id, submitted_at, id);

CREATE TABLE provider_registry.provider_application_reviews (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES provider_registry.provider_applications(id),
  reviewer_user_id uuid NOT NULL REFERENCES identity.users(id),
  authority_grant_id uuid NOT NULL REFERENCES access_control.authority_grants(id),
  decision varchar(40) NOT NULL,
  reason varchar(1024) NOT NULL,
  from_status varchar(32) NOT NULL,
  to_status varchar(32) NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT provider_application_review_decision CHECK (
    decision IN ('INFORMATION_REQUESTED','RECOMMENDED','PLATFORM_REVIEW_STARTED','APPROVED','REJECTED')
  )
);
CREATE INDEX provider_application_reviews_application_idx
  ON provider_registry.provider_application_reviews (application_id, created_at, id);
CREATE TRIGGER provider_application_reviews_append_only
  BEFORE UPDATE OR DELETE ON provider_registry.provider_application_reviews
  FOR EACH ROW EXECUTE FUNCTION governance.reject_row_mutation();

CREATE OR REPLACE FUNCTION provider_registry.enforce_provider_application_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  actor_id uuid;
  approval_marker text;
BEGIN
  actor_id := governance.current_setting_uuid('app.user_id');
  approval_marker := current_setting('app.provider_approval_application_id', true);
  IF OLD.applicant_user_id IS DISTINCT FROM NEW.applicant_user_id OR
     OLD.tenant_id IS DISTINCT FROM NEW.tenant_id AND NEW.status <> 'APPROVED' OR
     OLD.facility_id IS DISTINCT FROM NEW.facility_id AND NEW.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'provider application ownership cannot change' USING ERRCODE = '42501';
  END IF;
  IF NEW.version <> OLD.version + 1 OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'provider application version must advance once' USING ERRCODE = '23514';
  END IF;
  IF (OLD.legal_name, OLD.display_name, OLD.registration_number, OLD.geographic_unit_id,
      OLD.facility_name, OLD.facility_type, OLD.public_phone)
     IS DISTINCT FROM
     (NEW.legal_name, NEW.display_name, NEW.registration_number, NEW.geographic_unit_id,
      NEW.facility_name, NEW.facility_type, NEW.public_phone) AND
     NOT (OLD.status IN ('DRAFT','NEEDS_INFORMATION') AND actor_id = OLD.applicant_user_id) THEN
    RAISE EXCEPTION 'provider application fields are not editable' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status IN ('SUBMITTED','WITHDRAWN') AND actor_id = OLD.applicant_user_id AND
     ((OLD.status IN ('DRAFT','NEEDS_INFORMATION') AND NEW.status = 'SUBMITTED') OR
      (OLD.status IN ('DRAFT','NEEDS_INFORMATION') AND NEW.status = 'WITHDRAWN')) THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'APPROVED' AND approval_marker = OLD.id::text AND
     OLD.status IN ('PROVINCE_RECOMMENDED','PLATFORM_REVIEW') THEN
    RETURN NEW;
  END IF;
  IF access_control.authority_allows('provider.review','provider',OLD.geographic_unit_id,NULL,statement_timestamp()) AND (
    (OLD.status IN ('SUBMITTED','PROVINCE_REVIEW','PLATFORM_REVIEW') AND NEW.status = 'NEEDS_INFORMATION') OR
    (OLD.status IN ('SUBMITTED','PROVINCE_REVIEW') AND NEW.status = 'PROVINCE_RECOMMENDED') OR
    (OLD.status = 'PROVINCE_RECOMMENDED' AND NEW.status = 'PLATFORM_REVIEW') OR
    (OLD.status IN ('SUBMITTED','PROVINCE_REVIEW','PROVINCE_RECOMMENDED','PLATFORM_REVIEW') AND NEW.status = 'REJECTED')
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid provider application transition' USING ERRCODE = '23514';
END;
$function$;
CREATE TRIGGER provider_application_transition_guard
  BEFORE UPDATE ON provider_registry.provider_applications
  FOR EACH ROW EXECUTE FUNCTION provider_registry.enforce_provider_application_transition();

ALTER TABLE provider_registry.provider_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_registry.provider_applications FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_applications_self_policy ON provider_registry.provider_applications
  TO PUBLIC
  USING (applicant_user_id = governance.current_setting_uuid('app.user_id'))
  WITH CHECK (applicant_user_id = governance.current_setting_uuid('app.user_id'));
CREATE POLICY provider_applications_authority_policy ON provider_registry.provider_applications
  TO PUBLIC
  USING (access_control.authority_allows(
    'provider.review','provider',geographic_unit_id,tenant_id,statement_timestamp()
  ))
  WITH CHECK (access_control.authority_allows(
    'provider.review','provider',geographic_unit_id,tenant_id,statement_timestamp()
  ));

ALTER TABLE provider_registry.provider_application_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_registry.provider_application_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_application_reviews_scope_policy
  ON provider_registry.provider_application_reviews TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM provider_registry.provider_applications application
       WHERE application.id = provider_application_reviews.application_id
    )
  )
  WITH CHECK (
    reviewer_user_id = governance.current_setting_uuid('app.user_id') AND
    authority_grant_id = governance.current_setting_uuid('app.authority_grant_id') AND
    EXISTS (
      SELECT 1 FROM provider_registry.provider_applications application
       WHERE application.id = provider_application_reviews.application_id
         AND application.applicant_user_id <> reviewer_user_id
         AND access_control.authority_allows(
           'provider.review','provider',application.geographic_unit_id,application.tenant_id,statement_timestamp()
         )
    )
  );

CREATE OR REPLACE FUNCTION provider_registry.approve_provider_application(
  selected_application_id uuid,
  expected_version integer,
  selected_review_id uuid,
  selected_tenant_id uuid,
  selected_facility_id uuid,
  selected_membership_id uuid,
  selected_access_assignment_id uuid,
  selected_reviewer_user_id uuid,
  selected_authority_grant_id uuid,
  selected_reason varchar,
  decided_at_value timestamptz,
  assignment_valid_until timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  application provider_registry.provider_applications%ROWTYPE;
  old_tenant text;
  old_scope text;
BEGIN
  IF selected_reviewer_user_id <> governance.current_setting_uuid('app.user_id') OR
     selected_authority_grant_id <> governance.current_setting_uuid('app.authority_grant_id') THEN
    RETURN false;
  END IF;
  SELECT * INTO application
    FROM provider_registry.provider_applications
   WHERE id = selected_application_id
   FOR UPDATE;
  IF NOT FOUND OR application.version <> expected_version OR
     application.status NOT IN ('PROVINCE_RECOMMENDED','PLATFORM_REVIEW') OR
     application.applicant_user_id = selected_reviewer_user_id OR
     NOT access_control.authority_allows(
       'provider.review','provider',application.geographic_unit_id,NULL,decided_at_value
     ) OR NOT EXISTS (
       SELECT 1 FROM access_control.authority_grants grant_record
        WHERE grant_record.id = selected_authority_grant_id AND grant_record.level = 'PLATFORM'
     ) OR EXISTS (
       SELECT 1 FROM provider_registry.provider_application_reviews review
        WHERE review.application_id = selected_application_id
          AND review.decision = 'RECOMMENDED'
          AND review.reviewer_user_id = selected_reviewer_user_id
     ) THEN
    RETURN false;
  END IF;

  old_tenant := current_setting('app.tenant_id', true);
  old_scope := current_setting('app.access_scope_type', true);
  PERFORM set_config('app.tenant_id', selected_tenant_id::text, true);
  PERFORM set_config('app.access_scope_type', 'TENANT', true);
  INSERT INTO tenancy.provider_organizations (
    id, legal_name, display_name, registration_number, operating_status, created_at, updated_at
  ) VALUES (
    selected_tenant_id, application.legal_name, application.display_name,
    application.registration_number, 'ACTIVE', decided_at_value, decided_at_value
  );
  INSERT INTO tenancy.facilities (
    id, tenant_id, geographic_unit_id, name, facility_type, operating_status,
    public_phone, created_at, updated_at
  ) VALUES (
    selected_facility_id, selected_tenant_id, application.geographic_unit_id,
    application.facility_name, application.facility_type, 'ACTIVE', application.public_phone,
    decided_at_value, decided_at_value
  );
  INSERT INTO tenancy.memberships (
    id, tenant_id, user_id, status, joined_at, created_at, updated_at
  ) VALUES (
    selected_membership_id, selected_tenant_id, application.applicant_user_id, 'ACTIVE',
    decided_at_value, decided_at_value, decided_at_value
  );
  INSERT INTO access_control.access_assignments (
    id, tenant_id, user_id, role_profile_id, scope_type, status, valid_from, valid_until,
    granted_by, delegation_evidence, approved_at, approval_reason, created_at, updated_at
  ) VALUES (
    selected_access_assignment_id, selected_tenant_id, application.applicant_user_id,
    '019a45f0-0000-7000-8200-000000000005', 'TENANT', 'ACTIVE', decided_at_value,
    assignment_valid_until, selected_reviewer_user_id,
    jsonb_build_object('source','PROVIDER_APPROVAL','applicationId',selected_application_id),
    decided_at_value, selected_reason, decided_at_value, decided_at_value
  );
  PERFORM set_config('app.tenant_id', COALESCE(old_tenant, ''), true);
  PERFORM set_config('app.access_scope_type', COALESCE(old_scope, ''), true);

  INSERT INTO provider_registry.provider_application_reviews (
    id, application_id, reviewer_user_id, authority_grant_id, decision, reason,
    from_status, to_status, created_at
  ) VALUES (
    selected_review_id, selected_application_id, selected_reviewer_user_id,
    selected_authority_grant_id, 'APPROVED', selected_reason, application.status,
    'APPROVED', decided_at_value
  );
  PERFORM set_config('app.provider_approval_application_id', selected_application_id::text, true);
  UPDATE provider_registry.provider_applications
     SET status = 'APPROVED', version = version + 1, tenant_id = selected_tenant_id,
         facility_id = selected_facility_id, decided_at = decided_at_value,
         updated_at = decided_at_value
   WHERE id = selected_application_id AND version = expected_version;
  PERFORM set_config('app.provider_approval_application_id', '', true);
  RETURN FOUND;
END;
$function$;

CREATE TABLE workforce.driver_applications (
  id uuid PRIMARY KEY,
  applicant_user_id uuid NOT NULL REFERENCES identity.users(id),
  tenant_id uuid NOT NULL REFERENCES tenancy.provider_organizations(id),
  facility_id uuid NOT NULL,
  licence_number varchar(128) NOT NULL,
  licence_expires_on date NOT NULL,
  status varchar(32) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id),
  CONSTRAINT driver_application_status CHECK (
    status IN ('DRAFT','SUBMITTED','NEEDS_INFORMATION','APPROVED','REJECTED','WITHDRAWN')
  ),
  CONSTRAINT driver_application_version CHECK (version > 0),
  CONSTRAINT driver_application_time_order CHECK (updated_at >= created_at),
  CONSTRAINT driver_application_decision_shape CHECK (
    (status IN ('APPROVED','REJECTED','WITHDRAWN') AND decided_at IS NOT NULL) OR
    (status NOT IN ('APPROVED','REJECTED','WITHDRAWN') AND decided_at IS NULL)
  )
);
CREATE UNIQUE INDEX driver_application_active_scope_idx
  ON workforce.driver_applications (tenant_id, facility_id, applicant_user_id)
  WHERE status NOT IN ('APPROVED','REJECTED','WITHDRAWN');

CREATE TABLE workforce.driver_application_reviews (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  application_id uuid NOT NULL,
  reviewer_user_id uuid NOT NULL REFERENCES identity.users(id),
  decision varchar(32) NOT NULL,
  reason varchar(1024) NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, application_id) REFERENCES workforce.driver_applications(tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id),
  CONSTRAINT driver_application_review_decision CHECK (
    decision IN ('INFORMATION_REQUESTED','APPROVED','REJECTED')
  )
);
CREATE TRIGGER driver_application_reviews_append_only
  BEFORE UPDATE OR DELETE ON workforce.driver_application_reviews
  FOR EACH ROW EXECUTE FUNCTION governance.reject_row_mutation();

CREATE TABLE workforce.driver_profiles (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenancy.provider_organizations(id),
  user_id uuid NOT NULL REFERENCES identity.users(id),
  licence_number varchar(128) NOT NULL,
  licence_expires_on date NOT NULL,
  verification_status varchar(32) NOT NULL,
  account_status varchar(24) NOT NULL,
  duty_status varchar(24) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id),
  UNIQUE (tenant_id, licence_number),
  CONSTRAINT driver_verification_status CHECK (
    verification_status IN ('PENDING','NEEDS_INFORMATION','VERIFIED','REJECTED','EXPIRED')
  ),
  CONSTRAINT driver_account_status CHECK (account_status IN ('ACTIVE','SUSPENDED','DEACTIVATED')),
  CONSTRAINT driver_duty_status CHECK (
    duty_status IN ('OFF_DUTY','AVAILABLE','RESERVED','ON_TRIP','UNAVAILABLE')
  ),
  CONSTRAINT driver_profile_version CHECK (version > 0),
  CONSTRAINT driver_profile_time_order CHECK (updated_at >= created_at)
);

CREATE TABLE workforce.driver_facility_assignments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id),
  FOREIGN KEY (tenant_id, driver_id) REFERENCES workforce.driver_profiles(tenant_id, id),
  CONSTRAINT driver_affiliation_validity CHECK (
    (valid_until IS NULL OR valid_until > valid_from) AND (ended_at IS NULL OR ended_at >= valid_from)
  )
);
CREATE UNIQUE INDEX driver_affiliation_active_facility_idx
  ON workforce.driver_facility_assignments (driver_id, facility_id) WHERE ended_at IS NULL;

CREATE OR REPLACE FUNCTION workforce.driver_is_in_scope(selected_tenant_id uuid, selected_driver_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT selected_tenant_id = governance.current_setting_uuid('app.tenant_id') AND (
    current_setting('app.access_scope_type', true) = 'TENANT' OR EXISTS (
      SELECT 1 FROM workforce.driver_facility_assignments affiliation
       WHERE affiliation.tenant_id = selected_tenant_id
         AND affiliation.driver_id = selected_driver_id
         AND affiliation.ended_at IS NULL
         AND affiliation.valid_from <= statement_timestamp()
         AND (affiliation.valid_until IS NULL OR affiliation.valid_until > statement_timestamp())
         AND affiliation.facility_id = ANY(governance.current_setting_uuid_array('app.facility_scope'))
    )
  );
$function$;

CREATE OR REPLACE FUNCTION workforce.authority_allows_driver(
  required_permission varchar,
  required_resource varchar,
  selected_tenant_id uuid,
  selected_driver_id uuid,
  evaluated_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM workforce.driver_facility_assignments affiliation
     WHERE affiliation.tenant_id = selected_tenant_id
       AND affiliation.driver_id = selected_driver_id
       AND affiliation.ended_at IS NULL
       AND affiliation.valid_from <= evaluated_at
       AND (affiliation.valid_until IS NULL OR affiliation.valid_until > evaluated_at)
       AND access_control.authority_allows_facility(
         required_permission,
         required_resource,
         affiliation.tenant_id,
         affiliation.facility_id,
         evaluated_at
       )
  );
$function$;

ALTER TABLE workforce.driver_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.driver_applications FORCE ROW LEVEL SECURITY;
CREATE POLICY driver_applications_self_policy ON workforce.driver_applications TO PUBLIC
  USING (applicant_user_id = governance.current_setting_uuid('app.user_id'))
  WITH CHECK (
    applicant_user_id = governance.current_setting_uuid('app.user_id') AND
    tenancy.facility_accepts_driver_application(tenant_id, facility_id)
  );
CREATE POLICY driver_applications_tenant_policy ON workforce.driver_applications TO PUBLIC
  USING (governance.facility_is_in_scope(tenant_id, facility_id))
  WITH CHECK (governance.facility_is_in_scope(tenant_id, facility_id));

ALTER TABLE workforce.driver_application_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.driver_application_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY driver_application_reviews_tenant_policy
  ON workforce.driver_application_reviews TO PUBLIC
  USING (governance.facility_is_in_scope(tenant_id, facility_id))
  WITH CHECK (
    governance.facility_is_in_scope(tenant_id, facility_id) AND
    reviewer_user_id = governance.current_setting_uuid('app.user_id')
  );

ALTER TABLE workforce.driver_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.driver_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY driver_profiles_tenant_select_policy ON workforce.driver_profiles
  FOR SELECT TO PUBLIC USING (
    workforce.driver_is_in_scope(tenant_id, id) OR
    workforce.authority_allows_driver('driver.read','driver',tenant_id,id,statement_timestamp())
  );
CREATE POLICY driver_profiles_tenant_insert_policy ON workforce.driver_profiles
  FOR INSERT TO PUBLIC WITH CHECK (tenant_id = governance.current_setting_uuid('app.tenant_id'));
CREATE POLICY driver_profiles_tenant_update_policy ON workforce.driver_profiles
  FOR UPDATE TO PUBLIC
  USING (workforce.driver_is_in_scope(tenant_id, id))
  WITH CHECK (workforce.driver_is_in_scope(tenant_id, id));

ALTER TABLE workforce.driver_facility_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.driver_facility_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY driver_facility_assignments_scope_policy
  ON workforce.driver_facility_assignments TO PUBLIC
  USING (governance.facility_is_in_scope(tenant_id, facility_id))
  WITH CHECK (governance.facility_is_in_scope(tenant_id, facility_id));
CREATE POLICY driver_facility_assignments_authority_select_policy
  ON workforce.driver_facility_assignments FOR SELECT TO PUBLIC
  USING (access_control.authority_allows_facility(
    'driver.read','driver',tenant_id,facility_id,statement_timestamp()
  ));

CREATE TABLE fleet.ambulances (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  registered_by_user_id uuid NOT NULL REFERENCES identity.users(id),
  plate_number varchar(32) NOT NULL,
  vin varchar(64),
  category varchar(64) NOT NULL,
  compliance_status varchar(32) NOT NULL,
  operational_status varchar(24) NOT NULL,
  gps_quality varchar(24) NOT NULL,
  readiness_status varchar(16) NOT NULL,
  readiness_reasons varchar(128)[] NOT NULL,
  readiness_version integer NOT NULL DEFAULT 1,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, plate_number),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id),
  CONSTRAINT ambulance_compliance_status CHECK (
    compliance_status IN ('PENDING_REVIEW','APPROVED','NEEDS_INFORMATION','REJECTED','SUSPENDED','EXPIRED')
  ),
  CONSTRAINT ambulance_operational_status CHECK (
    operational_status IN ('OFFLINE','AVAILABLE','RESERVED','DISPATCHED','MAINTENANCE','OUT_OF_SERVICE')
  ),
  CONSTRAINT ambulance_gps_quality CHECK (gps_quality IN ('LIVE','LAST_KNOWN','STALE','UNAVAILABLE')),
  CONSTRAINT ambulance_readiness_status CHECK (readiness_status IN ('READY','BLOCKED')),
  CONSTRAINT ambulance_versions CHECK (readiness_version > 0 AND version > 0),
  CONSTRAINT ambulance_time_order CHECK (updated_at >= created_at)
);

CREATE TABLE fleet.ambulance_compliance_reviews (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  ambulance_id uuid NOT NULL,
  reviewer_user_id uuid NOT NULL REFERENCES identity.users(id),
  authority_grant_id uuid NOT NULL REFERENCES access_control.authority_grants(id),
  from_status varchar(32) NOT NULL,
  to_status varchar(32) NOT NULL,
  reason varchar(1024) NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, ambulance_id) REFERENCES fleet.ambulances(tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id),
  CONSTRAINT ambulance_compliance_review_statuses CHECK (
    from_status IN ('PENDING_REVIEW','APPROVED','NEEDS_INFORMATION','REJECTED','SUSPENDED','EXPIRED') AND
    to_status IN ('APPROVED','NEEDS_INFORMATION','REJECTED','SUSPENDED','EXPIRED')
  )
);
CREATE INDEX ambulance_compliance_reviews_ambulance_idx
  ON fleet.ambulance_compliance_reviews (ambulance_id, created_at, id);
CREATE TRIGGER ambulance_compliance_reviews_append_only
  BEFORE UPDATE OR DELETE ON fleet.ambulance_compliance_reviews
  FOR EACH ROW EXECUTE FUNCTION governance.reject_row_mutation();

CREATE TABLE fleet.ambulance_equipment (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  ambulance_id uuid NOT NULL,
  equipment_type varchar(96) NOT NULL,
  required boolean NOT NULL,
  present boolean NOT NULL,
  expires_on date,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (ambulance_id, equipment_type),
  FOREIGN KEY (tenant_id, ambulance_id) REFERENCES fleet.ambulances(tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id),
  CONSTRAINT ambulance_equipment_version CHECK (version > 0)
);

CREATE TABLE fleet.maintenance_records (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  ambulance_id uuid NOT NULL,
  maintenance_type varchar(24) NOT NULL,
  status varchar(24) NOT NULL,
  scheduled_for timestamptz NOT NULL,
  odometer_meters bigint,
  notes varchar(2048) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, ambulance_id) REFERENCES fleet.ambulances(tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id),
  CONSTRAINT maintenance_type CHECK (maintenance_type IN ('PLANNED','UNPLANNED','INSPECTION')),
  CONSTRAINT maintenance_status CHECK (status IN ('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED')),
  CONSTRAINT maintenance_odometer CHECK (odometer_meters IS NULL OR odometer_meters >= 0),
  CONSTRAINT maintenance_completion_shape CHECK (
    (status = 'COMPLETED' AND completed_at IS NOT NULL) OR
    (status <> 'COMPLETED' AND completed_at IS NULL)
  ),
  CONSTRAINT maintenance_version CHECK (version > 0)
);
CREATE INDEX maintenance_due_idx
  ON fleet.maintenance_records (scheduled_for, id) WHERE status IN ('SCHEDULED','IN_PROGRESS');

CREATE TABLE fleet.crew_ambulance_assignments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  ambulance_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL,
  released_at timestamptz,
  release_reason varchar(512),
  FOREIGN KEY (tenant_id, ambulance_id) REFERENCES fleet.ambulances(tenant_id, id),
  FOREIGN KEY (tenant_id, driver_id) REFERENCES workforce.driver_profiles(tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id),
  CONSTRAINT crew_assignment_release_shape CHECK (
    (released_at IS NULL AND release_reason IS NULL) OR
    (released_at IS NOT NULL AND release_reason IS NOT NULL AND released_at >= assigned_at)
  )
);
CREATE UNIQUE INDEX crew_assignment_active_ambulance_idx
  ON fleet.crew_ambulance_assignments (ambulance_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX crew_assignment_active_driver_idx
  ON fleet.crew_ambulance_assignments (driver_id) WHERE released_at IS NULL;

CREATE TABLE fleet.device_bindings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  ambulance_id uuid NOT NULL,
  provider_code varchar(64) NOT NULL,
  terminal_reference_hash bytea NOT NULL,
  status varchar(24) NOT NULL,
  bound_at timestamptz NOT NULL,
  revoked_at timestamptz,
  UNIQUE (provider_code, terminal_reference_hash),
  FOREIGN KEY (tenant_id, ambulance_id) REFERENCES fleet.ambulances(tenant_id, id),
  CONSTRAINT device_binding_status CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','REVOKED')),
  CONSTRAINT device_binding_hash_length CHECK (octet_length(terminal_reference_hash) = 32),
  CONSTRAINT device_binding_revoke_shape CHECK (
    (status = 'REVOKED' AND revoked_at IS NOT NULL) OR (status <> 'REVOKED' AND revoked_at IS NULL)
  )
);

ALTER TABLE fleet.ambulances ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.ambulances FORCE ROW LEVEL SECURITY;
CREATE POLICY ambulances_scope_policy ON fleet.ambulances TO PUBLIC
  USING (
    governance.facility_is_in_scope(tenant_id, facility_id) OR
    access_control.authority_allows('ambulance.read','ambulance',
      (SELECT geographic_unit_id FROM tenancy.facilities facility
        WHERE facility.tenant_id = ambulances.tenant_id AND facility.id = ambulances.facility_id),
      tenant_id,statement_timestamp())
  )
  WITH CHECK (governance.facility_is_in_scope(tenant_id, facility_id));

ALTER TABLE fleet.ambulance_compliance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.ambulance_compliance_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY ambulance_compliance_reviews_authority_policy
  ON fleet.ambulance_compliance_reviews FOR SELECT TO PUBLIC
  USING (access_control.authority_allows_facility(
    'document.review','ambulance',tenant_id,facility_id,statement_timestamp()
  ));

ALTER TABLE fleet.ambulance_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.ambulance_equipment FORCE ROW LEVEL SECURITY;
CREATE POLICY ambulance_equipment_scope_policy ON fleet.ambulance_equipment TO PUBLIC
  USING (governance.facility_is_in_scope(tenant_id, facility_id))
  WITH CHECK (governance.facility_is_in_scope(tenant_id, facility_id));

ALTER TABLE fleet.maintenance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.maintenance_records FORCE ROW LEVEL SECURITY;
CREATE POLICY maintenance_records_scope_policy ON fleet.maintenance_records TO PUBLIC
  USING (governance.facility_is_in_scope(tenant_id, facility_id))
  WITH CHECK (governance.facility_is_in_scope(tenant_id, facility_id));

ALTER TABLE fleet.crew_ambulance_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.crew_ambulance_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY crew_ambulance_assignments_scope_policy ON fleet.crew_ambulance_assignments TO PUBLIC
  USING (governance.facility_is_in_scope(tenant_id, facility_id))
  WITH CHECK (governance.facility_is_in_scope(tenant_id, facility_id));

ALTER TABLE fleet.device_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.device_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY device_bindings_scope_policy ON fleet.device_bindings TO PUBLIC
  USING (governance.facility_is_in_scope(tenant_id, facility_id))
  WITH CHECK (governance.facility_is_in_scope(tenant_id, facility_id));

CREATE TABLE documents.document_objects (
  id uuid PRIMARY KEY,
  uploaded_by_user_id uuid NOT NULL REFERENCES identity.users(id),
  owner_user_id uuid REFERENCES identity.users(id),
  tenant_id uuid REFERENCES tenancy.provider_organizations(id),
  facility_id uuid,
  object_key varchar(512) NOT NULL UNIQUE,
  expected_sha256 bytea NOT NULL,
  size_bytes bigint NOT NULL,
  declared_mime_type varchar(128) NOT NULL,
  detected_mime_type varchar(128),
  encryption_key_version varchar(128),
  upload_status varchar(24) NOT NULL,
  scanner_code varchar(128),
  version integer NOT NULL DEFAULT 1,
  finalized_at timestamptz,
  scanned_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id),
  CONSTRAINT document_object_owner_shape CHECK (
    (owner_user_id IS NOT NULL AND tenant_id IS NULL AND facility_id IS NULL) OR
    (owner_user_id IS NULL AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT document_object_hash_length CHECK (octet_length(expected_sha256) = 32),
  CONSTRAINT document_object_size CHECK (size_bytes BETWEEN 1 AND 15728640),
  CONSTRAINT document_upload_status CHECK (
    upload_status IN ('PENDING_UPLOAD','UPLOADED','QUARANTINED','SCANNING','READY','FAILED','REMOVED')
  ),
  CONSTRAINT document_object_version CHECK (version > 0),
  CONSTRAINT document_object_time_order CHECK (updated_at >= created_at)
);

CREATE TABLE documents.user_identity_documents (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id),
  document_object_id uuid NOT NULL UNIQUE REFERENCES documents.document_objects(id),
  document_type varchar(96) NOT NULL,
  review_status varchar(32) NOT NULL,
  expires_on date,
  supersedes_id uuid REFERENCES documents.user_identity_documents(id),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE documents.provider_application_documents (
  id uuid PRIMARY KEY,
  provider_application_id uuid NOT NULL REFERENCES provider_registry.provider_applications(id),
  document_object_id uuid NOT NULL UNIQUE REFERENCES documents.document_objects(id),
  document_type varchar(96) NOT NULL,
  review_status varchar(32) NOT NULL,
  expires_on date,
  supersedes_id uuid REFERENCES documents.provider_application_documents(id),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE documents.driver_application_documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  driver_application_id uuid NOT NULL,
  document_object_id uuid NOT NULL UNIQUE REFERENCES documents.document_objects(id),
  document_type varchar(96) NOT NULL,
  review_status varchar(32) NOT NULL,
  expires_on date,
  supersedes_id uuid REFERENCES documents.driver_application_documents(id),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, driver_application_id) REFERENCES workforce.driver_applications(tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id)
);

CREATE TABLE documents.driver_documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  document_object_id uuid NOT NULL UNIQUE REFERENCES documents.document_objects(id),
  document_type varchar(96) NOT NULL,
  review_status varchar(32) NOT NULL,
  expires_on date,
  supersedes_id uuid REFERENCES documents.driver_documents(id),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, driver_id) REFERENCES workforce.driver_profiles(tenant_id, id)
);

CREATE TABLE documents.ambulance_documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  ambulance_id uuid NOT NULL,
  document_object_id uuid NOT NULL UNIQUE REFERENCES documents.document_objects(id),
  document_type varchar(96) NOT NULL,
  review_status varchar(32) NOT NULL,
  expires_on date,
  supersedes_id uuid REFERENCES documents.ambulance_documents(id),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, ambulance_id) REFERENCES fleet.ambulances(tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id)
);

CREATE TABLE documents.facility_documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  document_object_id uuid NOT NULL UNIQUE REFERENCES documents.document_objects(id),
  document_type varchar(96) NOT NULL,
  review_status varchar(32) NOT NULL,
  expires_on date,
  supersedes_id uuid REFERENCES documents.facility_documents(id),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, facility_id) REFERENCES tenancy.facilities(tenant_id, id)
);

ALTER TABLE documents.user_identity_documents
  ADD CONSTRAINT user_identity_document_review_status CHECK (
    review_status IN ('NOT_SUBMITTED','PENDING','APPROVED','NEEDS_INFORMATION','REJECTED','EXPIRED','REVOKED')
  );
ALTER TABLE documents.provider_application_documents
  ADD CONSTRAINT provider_application_document_review_status CHECK (
    review_status IN ('NOT_SUBMITTED','PENDING','APPROVED','NEEDS_INFORMATION','REJECTED','EXPIRED','REVOKED')
  );
ALTER TABLE documents.driver_application_documents
  ADD CONSTRAINT driver_application_document_review_status CHECK (
    review_status IN ('NOT_SUBMITTED','PENDING','APPROVED','NEEDS_INFORMATION','REJECTED','EXPIRED','REVOKED')
  );
ALTER TABLE documents.driver_documents
  ADD CONSTRAINT driver_document_review_status CHECK (
    review_status IN ('NOT_SUBMITTED','PENDING','APPROVED','NEEDS_INFORMATION','REJECTED','EXPIRED','REVOKED')
  );
ALTER TABLE documents.ambulance_documents
  ADD CONSTRAINT ambulance_document_review_status CHECK (
    review_status IN ('NOT_SUBMITTED','PENDING','APPROVED','NEEDS_INFORMATION','REJECTED','EXPIRED','REVOKED')
  );
ALTER TABLE documents.facility_documents
  ADD CONSTRAINT facility_document_review_status CHECK (
    review_status IN ('NOT_SUBMITTED','PENDING','APPROVED','NEEDS_INFORMATION','REJECTED','EXPIRED','REVOKED')
  );

CREATE TABLE documents.document_reviews (
  id uuid PRIMARY KEY,
  document_object_id uuid NOT NULL REFERENCES documents.document_objects(id),
  user_identity_document_id uuid REFERENCES documents.user_identity_documents(id),
  provider_application_document_id uuid REFERENCES documents.provider_application_documents(id),
  driver_application_document_id uuid REFERENCES documents.driver_application_documents(id),
  driver_document_id uuid REFERENCES documents.driver_documents(id),
  ambulance_document_id uuid REFERENCES documents.ambulance_documents(id),
  facility_document_id uuid REFERENCES documents.facility_documents(id),
  reviewer_user_id uuid NOT NULL REFERENCES identity.users(id),
  authority_grant_id uuid REFERENCES access_control.authority_grants(id),
  decision varchar(32) NOT NULL,
  reason varchar(1024) NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT document_review_subject_shape CHECK (
    num_nonnulls(user_identity_document_id, provider_application_document_id,
      driver_application_document_id, driver_document_id, ambulance_document_id,
      facility_document_id) = 1
  ),
  CONSTRAINT document_review_decision CHECK (
    decision IN ('APPROVED','NEEDS_INFORMATION','REJECTED','REVOKED')
  )
);
CREATE INDEX document_reviews_object_idx ON documents.document_reviews(document_object_id, created_at, id);
CREATE TRIGGER document_reviews_append_only
  BEFORE UPDATE OR DELETE ON documents.document_reviews
  FOR EACH ROW EXECUTE FUNCTION governance.reject_row_mutation();

CREATE OR REPLACE VIEW documents.document_projection
WITH (security_barrier = true, security_invoker = true)
AS
SELECT object.id, link.id AS link_id, object.uploaded_by_user_id, object.owner_user_id, object.tenant_id, object.facility_id,
       'USER_IDENTITY'::varchar AS subject_type, link.user_id AS subject_id,
       link.document_type, object.object_key, encode(object.expected_sha256, 'hex') AS expected_sha256,
       object.size_bytes, object.declared_mime_type, object.detected_mime_type,
       object.upload_status, link.review_status, link.expires_on, object.version
  FROM documents.document_objects object
  JOIN documents.user_identity_documents link ON link.document_object_id = object.id
UNION ALL
SELECT object.id, link.id, object.uploaded_by_user_id, object.owner_user_id, object.tenant_id, object.facility_id,
       'PROVIDER_APPLICATION', link.provider_application_id, link.document_type, object.object_key,
       encode(object.expected_sha256, 'hex'), object.size_bytes, object.declared_mime_type,
       object.detected_mime_type, object.upload_status, link.review_status, link.expires_on, object.version
  FROM documents.document_objects object
  JOIN documents.provider_application_documents link ON link.document_object_id = object.id
UNION ALL
SELECT object.id, link.id, object.uploaded_by_user_id, object.owner_user_id, object.tenant_id, object.facility_id,
       'DRIVER_APPLICATION', link.driver_application_id, link.document_type, object.object_key,
       encode(object.expected_sha256, 'hex'), object.size_bytes, object.declared_mime_type,
       object.detected_mime_type, object.upload_status, link.review_status, link.expires_on, object.version
  FROM documents.document_objects object
  JOIN documents.driver_application_documents link ON link.document_object_id = object.id
UNION ALL
SELECT object.id, link.id, object.uploaded_by_user_id, object.owner_user_id, object.tenant_id, object.facility_id,
       'DRIVER', link.driver_id, link.document_type, object.object_key,
       encode(object.expected_sha256, 'hex'), object.size_bytes, object.declared_mime_type,
       object.detected_mime_type, object.upload_status, link.review_status, link.expires_on, object.version
  FROM documents.document_objects object
  JOIN documents.driver_documents link ON link.document_object_id = object.id
UNION ALL
SELECT object.id, link.id, object.uploaded_by_user_id, object.owner_user_id, object.tenant_id, object.facility_id,
       'AMBULANCE', link.ambulance_id, link.document_type, object.object_key,
       encode(object.expected_sha256, 'hex'), object.size_bytes, object.declared_mime_type,
       object.detected_mime_type, object.upload_status, link.review_status, link.expires_on, object.version
  FROM documents.document_objects object
  JOIN documents.ambulance_documents link ON link.document_object_id = object.id
UNION ALL
SELECT object.id, link.id, object.uploaded_by_user_id, object.owner_user_id, object.tenant_id, object.facility_id,
       'FACILITY', link.facility_id, link.document_type, object.object_key,
       encode(object.expected_sha256, 'hex'), object.size_bytes, object.declared_mime_type,
       object.detected_mime_type, object.upload_status, link.review_status, link.expires_on, object.version
  FROM documents.document_objects object
  JOIN documents.facility_documents link ON link.document_object_id = object.id;

ALTER TABLE documents.document_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents.document_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY document_objects_principal_policy ON documents.document_objects TO PUBLIC
  USING (owner_user_id = governance.current_setting_uuid('app.user_id'))
  WITH CHECK (owner_user_id = governance.current_setting_uuid('app.user_id'));
CREATE POLICY document_objects_tenant_policy ON documents.document_objects TO PUBLIC
  USING (
    tenant_id = governance.current_setting_uuid('app.tenant_id') AND
    (facility_id IS NULL OR governance.facility_is_in_scope(tenant_id, facility_id))
  )
  WITH CHECK (
    tenant_id = governance.current_setting_uuid('app.tenant_id') AND
    (facility_id IS NULL OR governance.facility_is_in_scope(tenant_id, facility_id))
  );
CREATE POLICY document_objects_authority_policy ON documents.document_objects FOR SELECT TO PUBLIC
  USING (
    tenant_id IS NOT NULL AND access_control.authority_allows_tenant(
      'document.metadata.read','document',tenant_id,statement_timestamp()
    )
  );
CREATE POLICY document_objects_linked_select_policy ON documents.document_objects FOR SELECT TO PUBLIC
  USING (
    EXISTS (SELECT 1 FROM documents.user_identity_documents link
             WHERE link.document_object_id = document_objects.id) OR
    EXISTS (SELECT 1 FROM documents.provider_application_documents link
             WHERE link.document_object_id = document_objects.id) OR
    EXISTS (SELECT 1 FROM documents.driver_application_documents link
             WHERE link.document_object_id = document_objects.id) OR
    EXISTS (SELECT 1 FROM documents.driver_documents link
             WHERE link.document_object_id = document_objects.id) OR
    EXISTS (SELECT 1 FROM documents.ambulance_documents link
             WHERE link.document_object_id = document_objects.id) OR
    EXISTS (SELECT 1 FROM documents.facility_documents link
             WHERE link.document_object_id = document_objects.id)
  );
CREATE POLICY document_objects_linked_update_policy ON documents.document_objects FOR UPDATE TO PUBLIC
  USING (
    EXISTS (SELECT 1 FROM documents.provider_application_documents link
             WHERE link.document_object_id = document_objects.id) OR
    EXISTS (SELECT 1 FROM documents.driver_application_documents link
             WHERE link.document_object_id = document_objects.id) OR
    EXISTS (SELECT 1 FROM documents.driver_documents link
             WHERE link.document_object_id = document_objects.id) OR
    EXISTS (SELECT 1 FROM documents.ambulance_documents link
             WHERE link.document_object_id = document_objects.id) OR
    EXISTS (SELECT 1 FROM documents.facility_documents link
             WHERE link.document_object_id = document_objects.id)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM documents.provider_application_documents link
             WHERE link.document_object_id = document_objects.id) OR
    EXISTS (SELECT 1 FROM documents.driver_application_documents link
             WHERE link.document_object_id = document_objects.id) OR
    EXISTS (SELECT 1 FROM documents.driver_documents link
             WHERE link.document_object_id = document_objects.id) OR
    EXISTS (SELECT 1 FROM documents.ambulance_documents link
             WHERE link.document_object_id = document_objects.id) OR
    EXISTS (SELECT 1 FROM documents.facility_documents link
             WHERE link.document_object_id = document_objects.id)
  );

ALTER TABLE documents.user_identity_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents.user_identity_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY user_identity_documents_self_policy ON documents.user_identity_documents TO PUBLIC
  USING (user_id = governance.current_setting_uuid('app.user_id'))
  WITH CHECK (user_id = governance.current_setting_uuid('app.user_id'));

ALTER TABLE documents.provider_application_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents.provider_application_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_application_documents_scope_policy
  ON documents.provider_application_documents TO PUBLIC
  USING (EXISTS (
    SELECT 1 FROM provider_registry.provider_applications application
     WHERE application.id = provider_application_documents.provider_application_id
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM provider_registry.provider_applications application
     WHERE application.id = provider_application_documents.provider_application_id
  ));

ALTER TABLE documents.driver_application_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents.driver_application_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY driver_application_documents_scope_policy
  ON documents.driver_application_documents TO PUBLIC
  USING (
    governance.facility_is_in_scope(tenant_id, facility_id) OR EXISTS (
      SELECT 1 FROM workforce.driver_applications application
       WHERE application.id = driver_application_documents.driver_application_id
         AND application.applicant_user_id = governance.current_setting_uuid('app.user_id')
    )
  )
  WITH CHECK (
    governance.facility_is_in_scope(tenant_id, facility_id) OR EXISTS (
      SELECT 1 FROM workforce.driver_applications application
       WHERE application.id = driver_application_documents.driver_application_id
         AND application.applicant_user_id = governance.current_setting_uuid('app.user_id')
    )
  );

ALTER TABLE documents.driver_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents.driver_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY driver_documents_scope_policy ON documents.driver_documents TO PUBLIC
  USING (workforce.driver_is_in_scope(tenant_id, driver_id))
  WITH CHECK (workforce.driver_is_in_scope(tenant_id, driver_id));
CREATE POLICY driver_documents_authority_select_policy ON documents.driver_documents
  FOR SELECT TO PUBLIC USING (workforce.authority_allows_driver(
    'document.metadata.read','document',tenant_id,driver_id,statement_timestamp()
  ));
CREATE POLICY driver_documents_authority_update_policy ON documents.driver_documents
  FOR UPDATE TO PUBLIC
  USING (workforce.authority_allows_driver(
    'document.review','document',tenant_id,driver_id,statement_timestamp()
  ))
  WITH CHECK (workforce.authority_allows_driver(
    'document.review','document',tenant_id,driver_id,statement_timestamp()
  ));

ALTER TABLE documents.ambulance_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents.ambulance_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY ambulance_documents_scope_policy ON documents.ambulance_documents TO PUBLIC
  USING (governance.facility_is_in_scope(tenant_id, facility_id))
  WITH CHECK (governance.facility_is_in_scope(tenant_id, facility_id));
CREATE POLICY ambulance_documents_authority_select_policy ON documents.ambulance_documents
  FOR SELECT TO PUBLIC USING (access_control.authority_allows_facility(
    'document.metadata.read','document',tenant_id,facility_id,statement_timestamp()
  ));
CREATE POLICY ambulance_documents_authority_update_policy ON documents.ambulance_documents
  FOR UPDATE TO PUBLIC
  USING (access_control.authority_allows_facility(
    'document.review','document',tenant_id,facility_id,statement_timestamp()
  ))
  WITH CHECK (access_control.authority_allows_facility(
    'document.review','document',tenant_id,facility_id,statement_timestamp()
  ));

ALTER TABLE documents.facility_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents.facility_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY facility_documents_scope_policy ON documents.facility_documents TO PUBLIC
  USING (governance.facility_is_in_scope(tenant_id, facility_id))
  WITH CHECK (governance.facility_is_in_scope(tenant_id, facility_id));
CREATE POLICY facility_documents_authority_select_policy ON documents.facility_documents
  FOR SELECT TO PUBLIC USING (access_control.authority_allows_facility(
    'document.metadata.read','document',tenant_id,facility_id,statement_timestamp()
  ));
CREATE POLICY facility_documents_authority_update_policy ON documents.facility_documents
  FOR UPDATE TO PUBLIC
  USING (access_control.authority_allows_facility(
    'document.review','document',tenant_id,facility_id,statement_timestamp()
  ))
  WITH CHECK (access_control.authority_allows_facility(
    'document.review','document',tenant_id,facility_id,statement_timestamp()
  ));

ALTER TABLE documents.document_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents.document_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY document_reviews_visible_object_policy ON documents.document_reviews TO PUBLIC
  USING (EXISTS (
    SELECT 1 FROM documents.document_objects object
     WHERE object.id = document_reviews.document_object_id
  ))
  WITH CHECK (
    reviewer_user_id = governance.current_setting_uuid('app.user_id') AND EXISTS (
      SELECT 1 FROM documents.document_objects object
       WHERE object.id = document_reviews.document_object_id
         AND object.uploaded_by_user_id <> reviewer_user_id
    ) AND (
      authority_grant_id IS NULL OR
      authority_grant_id = governance.current_setting_uuid('app.authority_grant_id')
    )
  );

CREATE OR REPLACE FUNCTION fleet.refresh_ambulance_readiness(
  selected_ambulance_id uuid,
  evaluated_on date,
  evaluated_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  reasons varchar(128)[] := ARRAY[]::varchar[];
  ambulance fleet.ambulances%ROWTYPE;
BEGIN
  SELECT * INTO ambulance FROM fleet.ambulances WHERE id = selected_ambulance_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF ambulance.compliance_status <> 'APPROVED' THEN
    reasons := array_append(reasons, 'COMPLIANCE_NOT_APPROVED');
  END IF;
  IF EXISTS (
    SELECT 1 FROM fleet.ambulance_equipment equipment
     WHERE equipment.ambulance_id = selected_ambulance_id AND equipment.required AND
       (NOT equipment.present OR (equipment.expires_on IS NOT NULL AND equipment.expires_on < evaluated_on))
  ) THEN reasons := array_append(reasons, 'REQUIRED_EQUIPMENT_NOT_READY'); END IF;
  IF EXISTS (
    SELECT 1 FROM fleet.maintenance_records maintenance
     WHERE maintenance.ambulance_id = selected_ambulance_id AND maintenance.status = 'IN_PROGRESS'
  ) THEN reasons := array_append(reasons, 'MAINTENANCE_BLOCK'); END IF;
  IF NOT EXISTS (
    SELECT 1 FROM documents.ambulance_documents document
     JOIN documents.document_objects object ON object.id = document.document_object_id
    WHERE document.ambulance_id = selected_ambulance_id AND object.upload_status = 'READY' AND
      document.review_status = 'APPROVED' AND
      (document.expires_on IS NULL OR document.expires_on >= evaluated_on)
  ) THEN reasons := array_append(reasons, 'DOCUMENTS_NOT_CURRENT'); END IF;
  UPDATE fleet.ambulances
     SET readiness_status = CASE WHEN cardinality(reasons) = 0 THEN 'READY' ELSE 'BLOCKED' END,
         readiness_reasons = reasons, readiness_version = readiness_version + 1,
         updated_at = evaluated_at
   WHERE id = selected_ambulance_id
     AND (readiness_reasons IS DISTINCT FROM reasons OR
          readiness_status IS DISTINCT FROM CASE WHEN cardinality(reasons) = 0 THEN 'READY' ELSE 'BLOCKED' END);
END;
$function$;

CREATE OR REPLACE FUNCTION fleet.review_ambulance_compliance(
  selected_ambulance_id uuid,
  expected_version integer,
  selected_review_id uuid,
  selected_status varchar,
  selected_reviewer_user_id uuid,
  selected_authority_grant_id uuid,
  selected_reason varchar,
  reviewed_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  ambulance fleet.ambulances%ROWTYPE;
  geography_id uuid;
BEGIN
  IF selected_reviewer_user_id <> governance.current_setting_uuid('app.user_id') OR
     selected_authority_grant_id <> governance.current_setting_uuid('app.authority_grant_id') OR
     selected_status NOT IN ('APPROVED','NEEDS_INFORMATION','REJECTED','SUSPENDED','EXPIRED') THEN
    RETURN false;
  END IF;
  SELECT * INTO ambulance
    FROM fleet.ambulances fleet_record
   WHERE fleet_record.id = selected_ambulance_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT facility.geographic_unit_id INTO geography_id
    FROM tenancy.facilities facility
   WHERE facility.tenant_id = ambulance.tenant_id AND facility.id = ambulance.facility_id;
  IF ambulance.version <> expected_version OR
     ambulance.compliance_status = selected_status OR
     ambulance.registered_by_user_id = selected_reviewer_user_id OR
     NOT access_control.authority_allows(
       'document.review','ambulance',geography_id,ambulance.tenant_id,reviewed_at
     ) THEN
    RETURN false;
  END IF;
  UPDATE fleet.ambulances
     SET compliance_status = selected_status, version = version + 1, updated_at = reviewed_at
   WHERE id = selected_ambulance_id AND version = expected_version;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO fleet.ambulance_compliance_reviews (
    id, tenant_id, facility_id, ambulance_id, reviewer_user_id, authority_grant_id,
    from_status, to_status, reason, created_at
  ) VALUES (
    selected_review_id, ambulance.tenant_id, ambulance.facility_id, ambulance.id,
    selected_reviewer_user_id, selected_authority_grant_id, ambulance.compliance_status,
    selected_status, selected_reason, reviewed_at
  );
  PERFORM fleet.refresh_ambulance_readiness(
    selected_ambulance_id, reviewed_at::date, reviewed_at
  );
  RETURN true;
END;
$function$;

DROP POLICY outbox_events_tenant_policy ON governance.outbox_events;
CREATE POLICY outbox_events_scoped_policy ON governance.outbox_events TO PUBLIC
  USING (
    (tenant_id IS NOT NULL AND tenant_id = governance.current_setting_uuid('app.tenant_id')) OR
    (tenant_id IS NULL AND actor_id = governance.current_setting_uuid('app.user_id')) OR
    (tenant_id IS NOT NULL AND access_control.authority_allows_tenant(
      'provider.review', aggregate_type, tenant_id, statement_timestamp()
    ))
  )
  WITH CHECK (
    (tenant_id IS NOT NULL AND tenant_id = governance.current_setting_uuid('app.tenant_id')) OR
    (tenant_id IS NULL AND actor_id = governance.current_setting_uuid('app.user_id')) OR
    (tenant_id IS NOT NULL AND access_control.authority_allows_tenant(
      CASE WHEN aggregate_type = 'documentObject' THEN 'document.review' ELSE 'provider.review' END,
      CASE WHEN aggregate_type = 'documentObject' THEN 'document' ELSE aggregate_type END,
      tenant_id, statement_timestamp()
    ))
  );

DROP POLICY event_stream_sequences_tenant_policy ON governance.event_stream_sequences;
CREATE POLICY event_stream_sequences_scoped_policy ON governance.event_stream_sequences TO PUBLIC
  USING (
    tenant_id = governance.current_setting_uuid('app.tenant_id') OR
    (tenant_id IS NULL AND governance.current_setting_uuid('app.user_id') IS NOT NULL) OR
    (tenant_id IS NOT NULL AND access_control.authority_allows_tenant(
      'document.review','document',tenant_id,statement_timestamp()
    ))
  )
  WITH CHECK (
    tenant_id = governance.current_setting_uuid('app.tenant_id') OR
    (tenant_id IS NULL AND governance.current_setting_uuid('app.user_id') IS NOT NULL) OR
    (tenant_id IS NOT NULL AND access_control.authority_allows_tenant(
      'document.review','document',tenant_id,statement_timestamp()
    ))
  );

CREATE POLICY job_intents_principal_policy ON governance.job_intents TO PUBLIC
  USING (
    tenant_id IS NULL AND requested_by_type = 'USER' AND
    requested_by_id = governance.current_setting_uuid('app.user_id')::text
  )
  WITH CHECK (
    tenant_id IS NULL AND requested_by_type = 'USER' AND
    requested_by_id = governance.current_setting_uuid('app.user_id')::text
  );
CREATE POLICY job_intents_authority_policy ON governance.job_intents TO PUBLIC
  USING (tenant_id IS NOT NULL AND access_control.authority_allows_tenant(
    'document.review','document',tenant_id,statement_timestamp()
  ))
  WITH CHECK (tenant_id IS NOT NULL AND access_control.authority_allows_tenant(
    'document.review','document',tenant_id,statement_timestamp()
  ));

CREATE POLICY audit_events_authority_tenant_policy ON governance.audit_events
  FOR ALL TO PUBLIC
  USING (
    tenant_id IS NOT NULL AND authority_grant_id = governance.current_setting_uuid('app.authority_grant_id') AND
    access_control.authority_allows_tenant('document.review','document',tenant_id,statement_timestamp())
  )
  WITH CHECK (
    tenant_id IS NOT NULL AND actor_id = governance.current_setting_uuid('app.user_id') AND
    authority_grant_id = governance.current_setting_uuid('app.authority_grant_id') AND
    access_control.authority_allows_tenant('document.review','document',tenant_id,statement_timestamp())
  );

REVOKE ALL ON ALL TABLES IN SCHEMA provider_registry FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA workforce FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA fleet FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA documents FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA provider_registry FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA workforce FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fleet FROM PUBLIC;
REVOKE ALL ON FUNCTION access_control.authority_allows(varchar,varchar,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION access_control.authority_allows_tenant(varchar,varchar,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION access_control.authority_allows_facility(varchar,varchar,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenancy.facility_accepts_driver_application(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION governance.facility_is_in_scope(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION workforce.authority_allows_driver(varchar,varchar,uuid,uuid,timestamptz) FROM PUBLIC;

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resq_application') THEN
    GRANT USAGE ON SCHEMA provider_registry, workforce, fleet, documents TO resq_application;
    GRANT EXECUTE ON FUNCTION governance.facility_is_in_scope(uuid,uuid),
      access_control.authority_allows(varchar,varchar,uuid,uuid,timestamptz),
      access_control.authority_allows_tenant(varchar,varchar,uuid,timestamptz),
      access_control.authority_allows_facility(varchar,varchar,uuid,uuid,timestamptz),
      tenancy.facility_accepts_driver_application(uuid,uuid),
      provider_registry.approve_provider_application(uuid,integer,uuid,uuid,uuid,uuid,uuid,uuid,uuid,varchar,timestamptz,timestamptz),
      workforce.driver_is_in_scope(uuid,uuid),
      workforce.authority_allows_driver(varchar,varchar,uuid,uuid,timestamptz),
      fleet.refresh_ambulance_readiness(uuid,date,timestamptz),
      fleet.review_ambulance_compliance(uuid,integer,uuid,varchar,uuid,uuid,varchar,timestamptz)
      TO resq_application;
    GRANT SELECT, INSERT, UPDATE ON provider_registry.provider_applications TO resq_application;
    GRANT SELECT, INSERT ON provider_registry.provider_application_reviews TO resq_application;
    GRANT SELECT, INSERT, UPDATE ON workforce.driver_applications, workforce.driver_profiles,
      workforce.driver_facility_assignments TO resq_application;
    GRANT SELECT, INSERT ON workforce.driver_application_reviews TO resq_application;
    GRANT SELECT, INSERT, UPDATE ON fleet.ambulances, fleet.ambulance_equipment,
      fleet.maintenance_records, fleet.crew_ambulance_assignments, fleet.device_bindings TO resq_application;
    GRANT SELECT ON fleet.ambulance_compliance_reviews TO resq_application;
    GRANT SELECT, INSERT, UPDATE ON documents.document_objects,
      documents.user_identity_documents, documents.provider_application_documents,
      documents.driver_application_documents,
      documents.driver_documents, documents.ambulance_documents, documents.facility_documents
      TO resq_application;
    GRANT SELECT, INSERT ON documents.document_reviews TO resq_application;
    GRANT SELECT ON documents.document_projection TO resq_application;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resq_worker') THEN
    GRANT USAGE ON SCHEMA provider_registry, workforce, fleet, documents TO resq_worker;
    GRANT EXECUTE ON FUNCTION governance.facility_is_in_scope(uuid,uuid),
      access_control.authority_allows(varchar,varchar,uuid,uuid,timestamptz),
      access_control.authority_allows_tenant(varchar,varchar,uuid,timestamptz),
      access_control.authority_allows_facility(varchar,varchar,uuid,uuid,timestamptz),
      workforce.driver_is_in_scope(uuid,uuid),
      workforce.authority_allows_driver(varchar,varchar,uuid,uuid,timestamptz),
      fleet.refresh_ambulance_readiness(uuid,date,timestamptz)
      TO resq_worker;
    GRANT SELECT ON provider_registry.provider_applications, workforce.driver_applications,
      workforce.driver_profiles, workforce.driver_facility_assignments, fleet.ambulances,
      fleet.ambulance_equipment, fleet.maintenance_records, documents.document_projection TO resq_worker;
    GRANT SELECT, UPDATE ON documents.document_objects, documents.user_identity_documents,
      documents.provider_application_documents, documents.driver_application_documents,
      documents.driver_documents,
      documents.ambulance_documents, documents.facility_documents TO resq_worker;
  END IF;
END;
$roles$;
`;

export class CreateProviderOperations1793664000003 implements MigrationInterface {
  readonly name = 'CreateProviderOperations1793664000003';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(PROVIDER_OPERATIONS_SQL);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Production migrations are forward-only; use a reviewed compensating migration'),
    );
  }
}
