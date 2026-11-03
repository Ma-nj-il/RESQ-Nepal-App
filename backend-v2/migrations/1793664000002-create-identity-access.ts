import type { MigrationInterface, QueryRunner } from 'typeorm';

export const IDENTITY_ACCESS_SQL = String.raw`
CREATE SCHEMA IF NOT EXISTS geography;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS tenancy;
CREATE SCHEMA IF NOT EXISTS access_control;

REVOKE ALL ON SCHEMA geography FROM PUBLIC;
REVOKE ALL ON SCHEMA identity FROM PUBLIC;
REVOKE ALL ON SCHEMA tenancy FROM PUBLIC;
REVOKE ALL ON SCHEMA access_control FROM PUBLIC;

CREATE OR REPLACE FUNCTION governance.current_setting_uuid_array(setting_name text)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
DECLARE
  raw_value text;
  result uuid[];
BEGIN
  raw_value := current_setting(setting_name, true);
  IF raw_value IS NULL OR raw_value = '' THEN
    RETURN ARRAY[]::uuid[];
  END IF;
  SELECT COALESCE(array_agg(value::uuid), ARRAY[]::uuid[])
    INTO result
    FROM jsonb_array_elements_text(raw_value::jsonb) AS values(value);
  RETURN result;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN
  RETURN ARRAY[]::uuid[];
END;
$function$;

CREATE OR REPLACE FUNCTION governance.reject_ownership_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF (to_jsonb(OLD) -> 'tenant_id') IS DISTINCT FROM (to_jsonb(NEW) -> 'tenant_id') OR
     (to_jsonb(OLD) -> 'facility_id') IS DISTINCT FROM (to_jsonb(NEW) -> 'facility_id') THEN
    RAISE EXCEPTION 'ownership columns cannot be changed by an ordinary update'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TABLE geography.geographic_units (
  id uuid PRIMARY KEY,
  parent_id uuid REFERENCES geography.geographic_units(id),
  level varchar(24) NOT NULL,
  code varchar(32) NOT NULL,
  name_en varchar(160) NOT NULL,
  name_ne varchar(160),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (level, code),
  CONSTRAINT geographic_unit_level CHECK (level IN ('COUNTRY', 'PROVINCE', 'DISTRICT', 'MUNICIPALITY', 'WARD')),
  CONSTRAINT geographic_unit_version CHECK (version > 0),
  CONSTRAINT geographic_unit_time_order CHECK (updated_at >= created_at),
  CONSTRAINT geographic_unit_parent_shape CHECK (
    (level = 'COUNTRY' AND parent_id IS NULL) OR (level <> 'COUNTRY' AND parent_id IS NOT NULL)
  )
);

CREATE TABLE identity.users (
  id uuid PRIMARY KEY,
  status varchar(24) NOT NULL,
  token_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deactivated_at timestamptz,
  UNIQUE (id, status),
  CONSTRAINT user_status CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
  CONSTRAINT user_token_version CHECK (token_version > 0),
  CONSTRAINT user_time_order CHECK (updated_at >= created_at),
  CONSTRAINT user_deactivation_shape CHECK (
    (status = 'DEACTIVATED' AND deactivated_at IS NOT NULL) OR
    (status <> 'DEACTIVATED' AND deactivated_at IS NULL)
  )
);

CREATE TABLE identity.user_profiles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES identity.users(id),
  display_name varchar(160),
  normalized_phone varchar(32),
  phone_masked varchar(32),
  locale varchar(16) NOT NULL DEFAULT 'en-NP',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT user_profile_version CHECK (version > 0),
  CONSTRAINT user_profile_time_order CHECK (updated_at >= created_at)
);

CREATE TABLE identity.auth_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id),
  identity_type varchar(24) NOT NULL,
  normalized_identifier varchar(320) NOT NULL,
  verified_at timestamptz,
  password_hash varchar(512),
  password_changed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (identity_type, normalized_identifier),
  UNIQUE (user_id, identity_type, normalized_identifier),
  CONSTRAINT auth_identity_type CHECK (identity_type IN ('PHONE', 'EMAIL', 'ADMIN_PASSWORD')),
  CONSTRAINT auth_identity_password_shape CHECK (
    (identity_type = 'ADMIN_PASSWORD' AND password_hash IS NOT NULL) OR
    (identity_type <> 'ADMIN_PASSWORD' AND password_hash IS NULL)
  ),
  CONSTRAINT auth_identity_time_order CHECK (updated_at >= created_at)
);

CREATE TABLE identity.otp_challenges (
  id uuid PRIMARY KEY,
  normalized_phone varchar(32) NOT NULL,
  purpose varchar(32) NOT NULL,
  code_digest bytea NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  maximum_attempts integer NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL,
  last_attempt_at timestamptz,
  CONSTRAINT otp_purpose CHECK (purpose IN ('REGISTRATION_OR_LOGIN', 'RECOVERY', 'STEP_UP')),
  CONSTRAINT otp_digest_length CHECK (octet_length(code_digest) = 32),
  CONSTRAINT otp_attempts CHECK (attempts >= 0 AND maximum_attempts BETWEEN 1 AND 20),
  CONSTRAINT otp_expiry CHECK (expires_at > created_at),
  CONSTRAINT otp_consumption_order CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);
CREATE INDEX otp_challenges_expiry_idx ON identity.otp_challenges(expires_at);

CREATE TABLE identity.auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id),
  client_type varchar(16) NOT NULL,
  device_label varchar(160),
  assurance varchar(16) NOT NULL,
  assurance_expires_at timestamptz,
  session_version integer NOT NULL DEFAULT 1,
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL,
  risk_blocked_at timestamptz,
  revoked_at timestamptz,
  revocation_reason varchar(128),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (user_id, id),
  CONSTRAINT auth_session_client_type CHECK (client_type IN ('MOBILE', 'BROWSER')),
  CONSTRAINT auth_session_assurance CHECK (assurance IN ('AAL1', 'AAL2')),
  CONSTRAINT auth_session_assurance_expiry CHECK (
    (assurance = 'AAL1' AND assurance_expires_at IS NULL) OR
    (assurance = 'AAL2' AND assurance_expires_at IS NOT NULL AND assurance_expires_at > created_at)
  ),
  CONSTRAINT auth_session_version CHECK (session_version > 0),
  CONSTRAINT auth_session_expiry CHECK (
    idle_expires_at > created_at AND absolute_expires_at > created_at AND
    idle_expires_at <= absolute_expires_at
  ),
  CONSTRAINT auth_session_revoke_shape CHECK (
    (revoked_at IS NULL AND revocation_reason IS NULL) OR
    (revoked_at IS NOT NULL AND revocation_reason IS NOT NULL)
  ),
  CONSTRAINT auth_session_time_order CHECK (updated_at >= created_at AND last_used_at >= created_at)
);
CREATE INDEX auth_sessions_user_active_idx ON identity.auth_sessions(user_id, last_used_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE identity.refresh_tokens (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES identity.auth_sessions(id),
  family_id uuid NOT NULL,
  predecessor_id uuid,
  successor_id uuid,
  token_digest bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  revocation_reason varchar(128),
  created_at timestamptz NOT NULL,
  UNIQUE (session_id, family_id, id),
  FOREIGN KEY (session_id, family_id, predecessor_id)
    REFERENCES identity.refresh_tokens(session_id, family_id, id),
  FOREIGN KEY (session_id, family_id, successor_id)
    REFERENCES identity.refresh_tokens(session_id, family_id, id),
  CONSTRAINT refresh_digest_length CHECK (octet_length(token_digest) = 32),
  CONSTRAINT refresh_expiry CHECK (expires_at > created_at),
  CONSTRAINT refresh_consumption_order CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CONSTRAINT refresh_revoke_shape CHECK (
    (revoked_at IS NULL AND revocation_reason IS NULL) OR
    (revoked_at IS NOT NULL AND revocation_reason IS NOT NULL)
  )
);
CREATE INDEX refresh_tokens_family_idx ON identity.refresh_tokens(family_id, created_at);
CREATE INDEX refresh_tokens_session_idx ON identity.refresh_tokens(session_id, created_at DESC);

CREATE TABLE identity.mfa_factors (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id),
  factor_type varchar(24) NOT NULL,
  label varchar(160) NOT NULL,
  encrypted_secret bytea,
  secret_key_version varchar(64),
  credential_id bytea,
  public_key bytea,
  sign_count bigint,
  last_used_step bigint,
  enrollment_expires_at timestamptz,
  verified_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (user_id, id),
  CONSTRAINT mfa_factor_type CHECK (factor_type IN ('TOTP', 'WEBAUTHN')),
  CONSTRAINT mfa_factor_secret_shape CHECK (
    (factor_type = 'TOTP' AND encrypted_secret IS NOT NULL AND secret_key_version IS NOT NULL AND credential_id IS NULL) OR
    (factor_type = 'WEBAUTHN' AND encrypted_secret IS NULL AND credential_id IS NOT NULL AND public_key IS NOT NULL)
  ),
  CONSTRAINT mfa_factor_last_step CHECK (last_used_step IS NULL OR last_used_step >= 0),
  CONSTRAINT mfa_factor_enrollment_shape CHECK (
    (verified_at IS NULL AND enrollment_expires_at IS NOT NULL AND enrollment_expires_at > created_at) OR
    (verified_at IS NOT NULL AND enrollment_expires_at IS NULL)
  ),
  CONSTRAINT mfa_factor_time_order CHECK (updated_at >= created_at)
);

CREATE TABLE identity.mfa_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id),
  purpose varchar(32) NOT NULL,
  authentication_method varchar(32) NOT NULL,
  client_type varchar(16),
  device_label varchar(160),
  session_id uuid,
  attempts integer NOT NULL DEFAULT 0,
  maximum_attempts integer NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (user_id, session_id) REFERENCES identity.auth_sessions(user_id, id),
  CONSTRAINT mfa_challenge_purpose CHECK (purpose IN ('LOGIN', 'STEP_UP', 'RECOVERY')),
  CONSTRAINT mfa_challenge_method CHECK (authentication_method IN ('PASSWORD', 'SESSION')),
  CONSTRAINT mfa_challenge_client_type CHECK (client_type IS NULL OR client_type IN ('MOBILE', 'BROWSER')),
  CONSTRAINT mfa_challenge_shape CHECK (
    (purpose = 'LOGIN' AND authentication_method = 'PASSWORD' AND client_type IS NOT NULL AND session_id IS NULL) OR
    (purpose = 'STEP_UP' AND authentication_method = 'SESSION' AND client_type IS NULL AND session_id IS NOT NULL) OR
    (purpose = 'RECOVERY')
  ),
  CONSTRAINT mfa_challenge_attempts CHECK (attempts >= 0 AND maximum_attempts BETWEEN 1 AND 20),
  CONSTRAINT mfa_challenge_expiry CHECK (expires_at > created_at)
);
CREATE INDEX mfa_challenges_user_expiry_idx ON identity.mfa_challenges(user_id, expires_at);

CREATE TABLE tenancy.provider_organizations (
  id uuid PRIMARY KEY,
  legal_name varchar(256) NOT NULL,
  display_name varchar(160) NOT NULL,
  registration_number varchar(128),
  operating_status varchar(24) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT provider_operating_status CHECK (operating_status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
  CONSTRAINT provider_version CHECK (version > 0),
  CONSTRAINT provider_time_order CHECK (updated_at >= created_at)
);

CREATE TABLE tenancy.facilities (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenancy.provider_organizations(id),
  geographic_unit_id uuid NOT NULL REFERENCES geography.geographic_units(id),
  name varchar(256) NOT NULL,
  facility_type varchar(64) NOT NULL,
  operating_status varchar(24) NOT NULL,
  public_phone varchar(32),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  CONSTRAINT facility_status CHECK (operating_status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
  CONSTRAINT facility_version CHECK (version > 0),
  CONSTRAINT facility_time_order CHECK (updated_at >= created_at)
);

CREATE TABLE tenancy.memberships (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenancy.provider_organizations(id),
  user_id uuid NOT NULL REFERENCES identity.users(id),
  status varchar(32) NOT NULL,
  joined_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  CONSTRAINT membership_status CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'ENDED')),
  CONSTRAINT membership_end_shape CHECK (
    (status = 'ENDED' AND ended_at IS NOT NULL) OR (status <> 'ENDED' AND ended_at IS NULL)
  ),
  CONSTRAINT membership_time_order CHECK (updated_at >= created_at)
);
CREATE UNIQUE INDEX memberships_active_user_tenant_idx
  ON tenancy.memberships(tenant_id, user_id) WHERE status <> 'ENDED';

CREATE TABLE access_control.permissions (
  code varchar(160) PRIMARY KEY,
  description varchar(512) NOT NULL,
  resource varchar(96) NOT NULL,
  action varchar(96) NOT NULL,
  risk_class varchar(24) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  retired_at timestamptz,
  CONSTRAINT permission_risk CHECK (risk_class IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT permission_retired_shape CHECK (
    (active AND retired_at IS NULL) OR (NOT active AND retired_at IS NOT NULL)
  )
);

CREATE TABLE access_control.roles (
  id uuid PRIMARY KEY,
  owner_type varchar(16) NOT NULL,
  tenant_id uuid REFERENCES tenancy.provider_organizations(id),
  name varchar(160) NOT NULL,
  description varchar(512) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES identity.users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  retired_at timestamptz,
  UNIQUE NULLS NOT DISTINCT (owner_type, tenant_id, name),
  UNIQUE NULLS NOT DISTINCT (tenant_id, id),
  CONSTRAINT role_owner_shape CHECK (
    (owner_type = 'SYSTEM' AND tenant_id IS NULL) OR
    (owner_type = 'TENANT' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT role_version CHECK (version > 0),
  CONSTRAINT role_active_shape CHECK ((active AND retired_at IS NULL) OR (NOT active AND retired_at IS NOT NULL)),
  CONSTRAINT role_time_order CHECK (updated_at >= created_at)
);

CREATE TABLE access_control.role_permissions (
  role_id uuid NOT NULL REFERENCES access_control.roles(id),
  permission_code varchar(160) NOT NULL REFERENCES access_control.permissions(code),
  tenant_id uuid,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (role_id, permission_code),
  FOREIGN KEY (tenant_id, role_id) REFERENCES access_control.roles(tenant_id, id)
);

CREATE TABLE access_control.role_profiles (
  id uuid PRIMARY KEY,
  owner_type varchar(16) NOT NULL,
  tenant_id uuid REFERENCES tenancy.provider_organizations(id),
  name varchar(160) NOT NULL,
  description varchar(512) NOT NULL,
  scope_ceiling varchar(32) NOT NULL,
  constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES identity.users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  retired_at timestamptz,
  UNIQUE NULLS NOT DISTINCT (owner_type, tenant_id, name),
  UNIQUE NULLS NOT DISTINCT (tenant_id, id),
  CONSTRAINT role_profile_owner_shape CHECK (
    (owner_type = 'SYSTEM' AND tenant_id IS NULL) OR
    (owner_type = 'TENANT' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT role_profile_scope CHECK (
    scope_ceiling IN ('SELF', 'ASSIGNED_TRIP', 'FACILITY_SET', 'TENANT', 'PROVINCE_GRANT', 'PLATFORM_GRANT')
  ),
  CONSTRAINT role_profile_constraints_object CHECK (jsonb_typeof(constraints) = 'object'),
  CONSTRAINT role_profile_version CHECK (version > 0),
  CONSTRAINT role_profile_active_shape CHECK ((active AND retired_at IS NULL) OR (NOT active AND retired_at IS NOT NULL)),
  CONSTRAINT role_profile_time_order CHECK (updated_at >= created_at)
);

CREATE TABLE access_control.role_profile_roles (
  profile_id uuid NOT NULL REFERENCES access_control.role_profiles(id),
  role_id uuid NOT NULL REFERENCES access_control.roles(id),
  tenant_id uuid,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (profile_id, role_id),
  FOREIGN KEY (tenant_id, profile_id) REFERENCES access_control.role_profiles(tenant_id, id)
);

CREATE TABLE access_control.access_assignments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenancy.provider_organizations(id),
  user_id uuid NOT NULL REFERENCES identity.users(id),
  role_profile_id uuid NOT NULL REFERENCES access_control.role_profiles(id),
  scope_type varchar(24) NOT NULL,
  status varchar(24) NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  granted_by uuid NOT NULL REFERENCES identity.users(id),
  delegation_evidence jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES identity.users(id),
  revocation_reason varchar(512),
  approved_at timestamptz,
  approval_reason varchar(512),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  CONSTRAINT assignment_scope CHECK (scope_type IN ('TENANT', 'FACILITY_SET')),
  CONSTRAINT assignment_status CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')),
  CONSTRAINT assignment_validity CHECK (valid_until > valid_from),
  CONSTRAINT assignment_delegation_object CHECK (jsonb_typeof(delegation_evidence) = 'object'),
  CONSTRAINT assignment_version CHECK (version > 0),
  CONSTRAINT assignment_revoke_shape CHECK (
    (status = 'REVOKED' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revocation_reason IS NOT NULL) OR
    (status <> 'REVOKED' AND revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
  ),
  CONSTRAINT assignment_time_order CHECK (updated_at >= created_at)
);
CREATE INDEX access_assignments_user_active_idx
  ON access_control.access_assignments(user_id, tenant_id, valid_from)
  WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX access_assignments_one_active_user_tenant_idx
  ON access_control.access_assignments(tenant_id, user_id) WHERE status = 'ACTIVE';

CREATE TABLE access_control.access_assignment_facilities (
  tenant_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (assignment_id, facility_id),
  FOREIGN KEY (tenant_id, assignment_id)
    REFERENCES access_control.access_assignments(tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id)
    REFERENCES tenancy.facilities(tenant_id, id)
);

CREATE TABLE access_control.authority_grants (
  id uuid PRIMARY KEY,
  subject_user_id uuid NOT NULL REFERENCES identity.users(id),
  issued_by_user_id uuid NOT NULL REFERENCES identity.users(id),
  approved_by_user_id uuid REFERENCES identity.users(id),
  parent_grant_id uuid REFERENCES access_control.authority_grants(id),
  approved_under_grant_id uuid REFERENCES access_control.authority_grants(id),
  role_profile_id uuid NOT NULL REFERENCES access_control.role_profiles(id),
  level varchar(24) NOT NULL,
  national_scope boolean NOT NULL DEFAULT false,
  purpose varchar(512) NOT NULL,
  human_reason varchar(1024) NOT NULL,
  status varchar(24) NOT NULL,
  valid_from timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  required_assurance varchar(16) NOT NULL,
  allows_pii boolean NOT NULL DEFAULT false,
  allows_document_content boolean NOT NULL DEFAULT false,
  allows_export boolean NOT NULL DEFAULT false,
  allows_intervention boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES identity.users(id),
  revocation_reason varchar(512),
  approved_at timestamptz,
  approval_reason varchar(512),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT authority_level CHECK (level IN ('PROVINCE', 'PLATFORM')),
  CONSTRAINT authority_status CHECK (
    status IN ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')
  ),
  CONSTRAINT authority_validity CHECK (expires_at > valid_from),
  CONSTRAINT authority_assurance CHECK (required_assurance = 'AAL2'),
  CONSTRAINT authority_version CHECK (version > 0),
  CONSTRAINT authority_issuer_subject_separation CHECK (issued_by_user_id <> subject_user_id),
  CONSTRAINT authority_parent_not_self CHECK (parent_grant_id IS NULL OR parent_grant_id <> id),
  CONSTRAINT authority_approval_grant_not_self CHECK (
    approved_under_grant_id IS NULL OR approved_under_grant_id <> id
  ),
  CONSTRAINT authority_dual_control CHECK (
    (
      status = 'PENDING_APPROVAL' AND approved_by_user_id IS NULL AND
      approved_under_grant_id IS NULL AND approved_at IS NULL AND approval_reason IS NULL
    ) OR (
      status IN ('ACTIVE', 'SUSPENDED', 'EXPIRED') AND approved_by_user_id IS NOT NULL AND
      ((parent_grant_id IS NULL AND approved_under_grant_id IS NULL) OR
       (parent_grant_id IS NOT NULL AND approved_under_grant_id IS NOT NULL)) AND
      approved_by_user_id <> issued_by_user_id AND approved_by_user_id <> subject_user_id AND
      approved_at IS NOT NULL AND approval_reason IS NOT NULL
    ) OR (
      status = 'REVOKED' AND (
        (
          approved_by_user_id IS NULL AND approved_under_grant_id IS NULL AND
          approved_at IS NULL AND approval_reason IS NULL
        ) OR (
          approved_by_user_id IS NOT NULL AND
          ((parent_grant_id IS NULL AND approved_under_grant_id IS NULL) OR
           (parent_grant_id IS NOT NULL AND approved_under_grant_id IS NOT NULL)) AND
          approved_by_user_id <> issued_by_user_id AND approved_by_user_id <> subject_user_id AND
          approved_at IS NOT NULL AND approval_reason IS NOT NULL
        )
      )
    )
  ),
  CONSTRAINT authority_revoke_shape CHECK (
    (status = 'REVOKED' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revocation_reason IS NOT NULL) OR
    (status <> 'REVOKED' AND revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
  ),
  CONSTRAINT authority_time_order CHECK (updated_at >= created_at)
);
CREATE INDEX authority_grants_subject_active_idx
  ON access_control.authority_grants(subject_user_id, expires_at) WHERE status = 'ACTIVE';

CREATE TABLE access_control.authority_grant_permissions (
  grant_id uuid NOT NULL REFERENCES access_control.authority_grants(id),
  permission_code varchar(160) NOT NULL REFERENCES access_control.permissions(code),
  PRIMARY KEY (grant_id, permission_code)
);

CREATE TABLE access_control.authority_grant_resources (
  grant_id uuid NOT NULL REFERENCES access_control.authority_grants(id),
  resource_class varchar(96) NOT NULL,
  PRIMARY KEY (grant_id, resource_class)
);

CREATE TABLE access_control.authority_grant_geographies (
  grant_id uuid NOT NULL REFERENCES access_control.authority_grants(id),
  geographic_unit_id uuid NOT NULL REFERENCES geography.geographic_units(id),
  PRIMARY KEY (grant_id, geographic_unit_id)
);

CREATE TABLE access_control.authority_grant_provider_inclusions (
  grant_id uuid NOT NULL REFERENCES access_control.authority_grants(id),
  tenant_id uuid NOT NULL REFERENCES tenancy.provider_organizations(id),
  PRIMARY KEY (grant_id, tenant_id)
);

CREATE TABLE access_control.authority_grant_provider_exclusions (
  grant_id uuid NOT NULL REFERENCES access_control.authority_grants(id),
  tenant_id uuid NOT NULL REFERENCES tenancy.provider_organizations(id),
  PRIMARY KEY (grant_id, tenant_id)
);

CREATE OR REPLACE FUNCTION access_control.authority_chain_is_active(
  selected_grant_id uuid,
  evaluated_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH RECURSIVE grant_chain AS (
    SELECT grant_record.id,
           grant_record.parent_grant_id,
           grant_record.approved_under_grant_id,
           grant_record.status,
           grant_record.valid_from,
           grant_record.expires_at,
           ARRAY[grant_record.id]::uuid[] AS visited,
           false AS cycle
      FROM access_control.authority_grants grant_record
     WHERE grant_record.id = selected_grant_id
    UNION ALL
    SELECT ancestor.id,
           ancestor.parent_grant_id,
           ancestor.approved_under_grant_id,
           ancestor.status,
           ancestor.valid_from,
           ancestor.expires_at,
           chain.visited || ancestor.id,
           ancestor.id = ANY(chain.visited)
      FROM grant_chain chain
      CROSS JOIN LATERAL (
        VALUES (chain.parent_grant_id), (chain.approved_under_grant_id)
      ) AS edge(ancestor_id)
      JOIN access_control.authority_grants ancestor ON ancestor.id = edge.ancestor_id
     WHERE edge.ancestor_id IS NOT NULL AND NOT chain.cycle
  )
  SELECT EXISTS (SELECT 1 FROM grant_chain WHERE id = selected_grant_id)
     AND NOT EXISTS (
       SELECT 1
         FROM grant_chain
        WHERE cycle OR status <> 'ACTIVE' OR valid_from > evaluated_at OR expires_at <= evaluated_at
     );
$function$;

CREATE OR REPLACE FUNCTION access_control.can_administer_authority(
  subject_id uuid,
  selected_grant_id uuid,
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
      FROM access_control.authority_grants grant_record
      JOIN access_control.authority_grant_permissions permission
        ON permission.grant_id = grant_record.id
       AND permission.permission_code = 'access.authority.grant'
     WHERE grant_record.id = selected_grant_id
       AND grant_record.subject_user_id = subject_id
       AND subject_id = governance.current_setting_uuid('app.user_id')
       AND grant_record.status = 'ACTIVE'
       AND grant_record.valid_from <= evaluated_at
       AND grant_record.expires_at > evaluated_at
       AND access_control.authority_chain_is_active(grant_record.id, evaluated_at)
  );
$function$;

CREATE OR REPLACE FUNCTION access_control.authority_target_user_is_active(
  selected_user_id uuid,
  evaluated_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  acting_user_id uuid;
  administering_grant_id uuid;
BEGIN
  acting_user_id := governance.current_setting_uuid('app.user_id');
  administering_grant_id := governance.current_setting_uuid('app.authority_grant_id');
  IF acting_user_id IS NULL OR administering_grant_id IS NULL OR
     NOT access_control.can_administer_authority(
       acting_user_id,
       administering_grant_id,
       evaluated_at
     ) THEN
    RETURN false;
  END IF;
  PERFORM set_config('app.authority_target_user_id', selected_user_id::text, true);
  RETURN EXISTS (
    SELECT 1 FROM identity.users user_record
     WHERE user_record.id = selected_user_id AND user_record.status = 'ACTIVE'
  );
END;
$function$;

ALTER TABLE identity.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_self_policy ON identity.users TO PUBLIC
  USING (id = governance.current_setting_uuid('app.user_id'))
  WITH CHECK (id = governance.current_setting_uuid('app.user_id'));

ALTER TABLE identity.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.user_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY user_profiles_self_policy ON identity.user_profiles TO PUBLIC
  USING (user_id = governance.current_setting_uuid('app.user_id'))
  WITH CHECK (user_id = governance.current_setting_uuid('app.user_id'));

ALTER TABLE identity.auth_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.auth_identities FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_identities_self_policy ON identity.auth_identities TO PUBLIC
  USING (user_id = governance.current_setting_uuid('app.user_id'));

ALTER TABLE identity.otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.otp_challenges FORCE ROW LEVEL SECURITY;

ALTER TABLE identity.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.auth_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_sessions_self_policy ON identity.auth_sessions TO PUBLIC
  USING (user_id = governance.current_setting_uuid('app.user_id'))
  WITH CHECK (user_id = governance.current_setting_uuid('app.user_id'));

ALTER TABLE identity.refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.refresh_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY refresh_tokens_self_policy ON identity.refresh_tokens TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM identity.auth_sessions session
       WHERE session.id = refresh_tokens.session_id
         AND session.user_id = governance.current_setting_uuid('app.user_id')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM identity.auth_sessions session
       WHERE session.id = refresh_tokens.session_id
         AND session.user_id = governance.current_setting_uuid('app.user_id')
    )
  );

ALTER TABLE identity.mfa_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.mfa_factors FORCE ROW LEVEL SECURITY;
CREATE POLICY mfa_factors_self_policy ON identity.mfa_factors TO PUBLIC
  USING (user_id = governance.current_setting_uuid('app.user_id'))
  WITH CHECK (user_id = governance.current_setting_uuid('app.user_id'));

ALTER TABLE identity.mfa_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.mfa_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY mfa_challenges_self_policy ON identity.mfa_challenges TO PUBLIC
  USING (user_id = governance.current_setting_uuid('app.user_id'))
  WITH CHECK (user_id = governance.current_setting_uuid('app.user_id'));

ALTER TABLE tenancy.provider_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenancy.provider_organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_organizations_tenant_policy ON tenancy.provider_organizations TO PUBLIC
  USING (id = governance.current_setting_uuid('app.tenant_id'))
  WITH CHECK (id = governance.current_setting_uuid('app.tenant_id'));

ALTER TABLE tenancy.facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenancy.facilities FORCE ROW LEVEL SECURITY;
CREATE POLICY facilities_tenant_policy ON tenancy.facilities TO PUBLIC
  USING (
    tenant_id = governance.current_setting_uuid('app.tenant_id') AND
    (
      current_setting('app.access_scope_type', true) = 'TENANT' OR
      (
        current_setting('app.access_scope_type', true) = 'FACILITY_SET' AND
        id = ANY(governance.current_setting_uuid_array('app.facility_scope'))
      )
    )
  )
  WITH CHECK (
    tenant_id = governance.current_setting_uuid('app.tenant_id') AND
    (
      current_setting('app.access_scope_type', true) = 'TENANT' OR
      (
        current_setting('app.access_scope_type', true) = 'FACILITY_SET' AND
        id = ANY(governance.current_setting_uuid_array('app.facility_scope'))
      )
    )
  );

ALTER TABLE tenancy.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenancy.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_scope_policy ON tenancy.memberships TO PUBLIC
  USING (
    user_id = governance.current_setting_uuid('app.user_id') OR
    tenant_id = governance.current_setting_uuid('app.tenant_id')
  )
  WITH CHECK (tenant_id = governance.current_setting_uuid('app.tenant_id'));

ALTER TABLE access_control.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_control.roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_scope_policy ON access_control.roles TO PUBLIC
  USING (owner_type = 'SYSTEM' OR tenant_id = governance.current_setting_uuid('app.tenant_id'))
  WITH CHECK (owner_type = 'TENANT' AND tenant_id = governance.current_setting_uuid('app.tenant_id'));

ALTER TABLE access_control.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_control.role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_scope_policy ON access_control.role_permissions TO PUBLIC
  USING (tenant_id IS NULL OR tenant_id = governance.current_setting_uuid('app.tenant_id'))
  WITH CHECK (tenant_id = governance.current_setting_uuid('app.tenant_id'));

ALTER TABLE access_control.role_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_control.role_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY role_profiles_scope_policy ON access_control.role_profiles TO PUBLIC
  USING (owner_type = 'SYSTEM' OR tenant_id = governance.current_setting_uuid('app.tenant_id'))
  WITH CHECK (owner_type = 'TENANT' AND tenant_id = governance.current_setting_uuid('app.tenant_id'));

ALTER TABLE access_control.role_profile_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_control.role_profile_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY role_profile_roles_scope_policy ON access_control.role_profile_roles TO PUBLIC
  USING (tenant_id IS NULL OR tenant_id = governance.current_setting_uuid('app.tenant_id'))
  WITH CHECK (tenant_id = governance.current_setting_uuid('app.tenant_id'));

ALTER TABLE access_control.access_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_control.access_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY access_assignments_scope_policy ON access_control.access_assignments TO PUBLIC
  USING (
    user_id = governance.current_setting_uuid('app.user_id') OR
    tenant_id = governance.current_setting_uuid('app.tenant_id')
  )
  WITH CHECK (tenant_id = governance.current_setting_uuid('app.tenant_id'));

ALTER TABLE access_control.access_assignment_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_control.access_assignment_facilities FORCE ROW LEVEL SECURITY;
CREATE POLICY access_assignment_facilities_tenant_policy
  ON access_control.access_assignment_facilities TO PUBLIC
  USING (tenant_id = governance.current_setting_uuid('app.tenant_id'))
  WITH CHECK (tenant_id = governance.current_setting_uuid('app.tenant_id'));

ALTER TABLE access_control.authority_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_control.authority_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY authority_grants_read_policy ON access_control.authority_grants
  FOR SELECT TO PUBLIC
  USING (
    subject_user_id = governance.current_setting_uuid('app.user_id') OR
    issued_by_user_id = governance.current_setting_uuid('app.user_id') OR
    approved_by_user_id = governance.current_setting_uuid('app.user_id') OR
    id = governance.current_setting_uuid('app.authority_grant_id') OR
    (
      id = governance.current_setting_uuid('app.authority_target_grant_id') AND
      access_control.can_administer_authority(
        governance.current_setting_uuid('app.user_id'),
        governance.current_setting_uuid('app.authority_grant_id'),
        statement_timestamp()
      )
    )
  );
CREATE POLICY authority_grants_insert_policy ON access_control.authority_grants
  FOR INSERT TO PUBLIC
  WITH CHECK (
    issued_by_user_id = governance.current_setting_uuid('app.user_id') AND
    parent_grant_id = governance.current_setting_uuid('app.authority_grant_id') AND
    status = 'PENDING_APPROVAL' AND approved_by_user_id IS NULL AND
    approved_under_grant_id IS NULL
  );
CREATE POLICY authority_grants_update_policy ON access_control.authority_grants
  FOR UPDATE TO PUBLIC
  USING (
    id = governance.current_setting_uuid('app.authority_target_grant_id') AND
    access_control.can_administer_authority(
      governance.current_setting_uuid('app.user_id'),
      governance.current_setting_uuid('app.authority_grant_id'),
      statement_timestamp()
    )
  )
  WITH CHECK (
    id = governance.current_setting_uuid('app.authority_target_grant_id') AND
    (
      (
        status = 'ACTIVE' AND approved_by_user_id = governance.current_setting_uuid('app.user_id') AND
        approved_under_grant_id = governance.current_setting_uuid('app.authority_grant_id')
      ) OR (
        status = 'REVOKED' AND revoked_by = governance.current_setting_uuid('app.user_id')
      )
    ) AND
    (
      access_control.can_administer_authority(
        governance.current_setting_uuid('app.user_id'),
        governance.current_setting_uuid('app.authority_grant_id'),
        statement_timestamp()
      )
    )
  );

ALTER TABLE access_control.authority_grant_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_control.authority_grant_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY authority_grant_permissions_scope_policy
  ON access_control.authority_grant_permissions FOR SELECT TO PUBLIC
  USING (
    EXISTS (SELECT 1 FROM access_control.authority_grants grant_record
             WHERE grant_record.id = authority_grant_permissions.grant_id)
  );
CREATE POLICY authority_grant_permissions_insert_policy
  ON access_control.authority_grant_permissions FOR INSERT TO PUBLIC
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM access_control.authority_grants grant_record
       WHERE grant_record.id = authority_grant_permissions.grant_id
         AND grant_record.status = 'PENDING_APPROVAL'
         AND grant_record.issued_by_user_id = governance.current_setting_uuid('app.user_id')
         AND grant_record.parent_grant_id = governance.current_setting_uuid('app.authority_grant_id')
    )
  );

ALTER TABLE access_control.authority_grant_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_control.authority_grant_resources FORCE ROW LEVEL SECURITY;
CREATE POLICY authority_grant_resources_scope_policy
  ON access_control.authority_grant_resources FOR SELECT TO PUBLIC
  USING (
    EXISTS (SELECT 1 FROM access_control.authority_grants grant_record
             WHERE grant_record.id = authority_grant_resources.grant_id)
  );
CREATE POLICY authority_grant_resources_insert_policy
  ON access_control.authority_grant_resources FOR INSERT TO PUBLIC
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM access_control.authority_grants grant_record
       WHERE grant_record.id = authority_grant_resources.grant_id
         AND grant_record.status = 'PENDING_APPROVAL'
         AND grant_record.issued_by_user_id = governance.current_setting_uuid('app.user_id')
         AND grant_record.parent_grant_id = governance.current_setting_uuid('app.authority_grant_id')
    )
  );

ALTER TABLE access_control.authority_grant_geographies ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_control.authority_grant_geographies FORCE ROW LEVEL SECURITY;
CREATE POLICY authority_grant_geographies_scope_policy
  ON access_control.authority_grant_geographies FOR SELECT TO PUBLIC
  USING (
    EXISTS (SELECT 1 FROM access_control.authority_grants grant_record
             WHERE grant_record.id = authority_grant_geographies.grant_id)
  );
CREATE POLICY authority_grant_geographies_insert_policy
  ON access_control.authority_grant_geographies FOR INSERT TO PUBLIC
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM access_control.authority_grants grant_record
       WHERE grant_record.id = authority_grant_geographies.grant_id
         AND grant_record.status = 'PENDING_APPROVAL'
         AND grant_record.issued_by_user_id = governance.current_setting_uuid('app.user_id')
         AND grant_record.parent_grant_id = governance.current_setting_uuid('app.authority_grant_id')
    )
  );

ALTER TABLE access_control.authority_grant_provider_inclusions ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_control.authority_grant_provider_inclusions FORCE ROW LEVEL SECURITY;
CREATE POLICY authority_grant_provider_inclusions_scope_policy
  ON access_control.authority_grant_provider_inclusions FOR SELECT TO PUBLIC
  USING (
    EXISTS (SELECT 1 FROM access_control.authority_grants grant_record
             WHERE grant_record.id = authority_grant_provider_inclusions.grant_id)
  );
CREATE POLICY authority_grant_provider_inclusions_insert_policy
  ON access_control.authority_grant_provider_inclusions FOR INSERT TO PUBLIC
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM access_control.authority_grants grant_record
       WHERE grant_record.id = authority_grant_provider_inclusions.grant_id
         AND grant_record.status = 'PENDING_APPROVAL'
         AND grant_record.issued_by_user_id = governance.current_setting_uuid('app.user_id')
         AND grant_record.parent_grant_id = governance.current_setting_uuid('app.authority_grant_id')
    )
  );

ALTER TABLE access_control.authority_grant_provider_exclusions ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_control.authority_grant_provider_exclusions FORCE ROW LEVEL SECURITY;
CREATE POLICY authority_grant_provider_exclusions_scope_policy
  ON access_control.authority_grant_provider_exclusions FOR SELECT TO PUBLIC
  USING (
    EXISTS (SELECT 1 FROM access_control.authority_grants grant_record
             WHERE grant_record.id = authority_grant_provider_exclusions.grant_id)
  );
CREATE POLICY authority_grant_provider_exclusions_insert_policy
  ON access_control.authority_grant_provider_exclusions FOR INSERT TO PUBLIC
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM access_control.authority_grants grant_record
       WHERE grant_record.id = authority_grant_provider_exclusions.grant_id
         AND grant_record.status = 'PENDING_APPROVAL'
         AND grant_record.issued_by_user_id = governance.current_setting_uuid('app.user_id')
         AND grant_record.parent_grant_id = governance.current_setting_uuid('app.authority_grant_id')
    )
  );

-- The migration owner is the owner of the SECURITY DEFINER functions below. These narrowly scoped
-- policies let only that owner access a selected target while FORCE RLS remains enabled. Runtime
-- roles cannot satisfy the policy even if they set the custom claim themselves.
DO $internal_owner_policies$
DECLARE
  migration_owner name := current_user;
BEGIN
  EXECUTE format($policy$
    CREATE POLICY users_internal_security_definer_policy ON identity.users
      TO %I
      USING (
        id = governance.current_setting_uuid('app.authority_target_user_id') OR
        id = governance.current_setting_uuid('app.access_revocation_user_id')
      )
      WITH CHECK (
        id = governance.current_setting_uuid('app.authority_target_user_id') OR
        id = governance.current_setting_uuid('app.access_revocation_user_id')
      )
  $policy$, migration_owner);
  EXECUTE format($policy$
    CREATE POLICY auth_sessions_internal_security_definer_policy ON identity.auth_sessions
      TO %I
      USING (user_id = governance.current_setting_uuid('app.access_revocation_user_id'))
      WITH CHECK (user_id = governance.current_setting_uuid('app.access_revocation_user_id'))
  $policy$, migration_owner);
  EXECUTE format($policy$
    CREATE POLICY refresh_tokens_internal_security_definer_policy ON identity.refresh_tokens
      TO %I
      USING (
        EXISTS (
          SELECT 1 FROM identity.auth_sessions session
           WHERE session.id = refresh_tokens.session_id
             AND session.user_id = governance.current_setting_uuid('app.access_revocation_user_id')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM identity.auth_sessions session
           WHERE session.id = refresh_tokens.session_id
             AND session.user_id = governance.current_setting_uuid('app.access_revocation_user_id')
        )
      )
  $policy$, migration_owner);
  EXECUTE format($policy$
    CREATE POLICY authority_grants_internal_security_definer_policy
      ON access_control.authority_grants TO %I
      USING (true)
      WITH CHECK (true)
  $policy$, migration_owner);
END;
$internal_owner_policies$;

CREATE OR REPLACE FUNCTION access_control.enforce_role_permission_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  role_owner_type varchar;
  role_tenant_id uuid;
BEGIN
  SELECT owner_type, tenant_id INTO role_owner_type, role_tenant_id
    FROM access_control.roles WHERE id = NEW.role_id;
  IF role_owner_type IS NULL OR
     (role_owner_type = 'SYSTEM' AND NEW.tenant_id IS NOT NULL) OR
     (role_owner_type = 'TENANT' AND NEW.tenant_id IS DISTINCT FROM role_tenant_id) THEN
    RAISE EXCEPTION 'role permission ownership does not match its role'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION access_control.enforce_profile_role_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  profile_owner_type varchar;
  profile_tenant_id uuid;
  role_owner_type varchar;
  role_tenant_id uuid;
BEGIN
  SELECT owner_type, tenant_id INTO profile_owner_type, profile_tenant_id
    FROM access_control.role_profiles WHERE id = NEW.profile_id;
  SELECT owner_type, tenant_id INTO role_owner_type, role_tenant_id
    FROM access_control.roles WHERE id = NEW.role_id;
  IF profile_owner_type IS NULL OR role_owner_type IS NULL OR
     (profile_owner_type = 'SYSTEM' AND (NEW.tenant_id IS NOT NULL OR role_owner_type <> 'SYSTEM')) OR
     (profile_owner_type = 'TENANT' AND (
       NEW.tenant_id IS DISTINCT FROM profile_tenant_id OR
       (role_owner_type = 'TENANT' AND role_tenant_id IS DISTINCT FROM profile_tenant_id)
     )) THEN
    RAISE EXCEPTION 'role profile ownership does not match its role'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION access_control.enforce_assignment_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  profile_owner_type varchar;
  profile_tenant_id uuid;
BEGIN
  SELECT owner_type, tenant_id INTO profile_owner_type, profile_tenant_id
    FROM access_control.role_profiles WHERE id = NEW.role_profile_id;
  IF profile_owner_type IS NULL OR
     (profile_owner_type = 'TENANT' AND profile_tenant_id IS DISTINCT FROM NEW.tenant_id) THEN
    RAISE EXCEPTION 'assignment profile belongs to another tenant'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' OR
     OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR
     OLD.user_id IS DISTINCT FROM NEW.user_id OR
     OLD.role_profile_id IS DISTINCT FROM NEW.role_profile_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM tenancy.memberships membership
       WHERE membership.tenant_id = NEW.tenant_id
         AND membership.user_id = NEW.user_id
         AND membership.status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'assignment subject requires an active tenant membership'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION access_control.enforce_authority_profile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  profile_scope varchar;
  profile_owner varchar;
BEGIN
  IF NEW.parent_grant_id IS NULL AND
     EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resq_application') AND
     pg_has_role(current_user, 'resq_application', 'MEMBER') THEN
    RAISE EXCEPTION 'parentless authority grants require a reviewed bootstrap migration'
      USING ERRCODE = '42501';
  END IF;
  SELECT owner_type, scope_ceiling INTO profile_owner, profile_scope
    FROM access_control.role_profiles WHERE id = NEW.role_profile_id;
  IF profile_owner IS DISTINCT FROM 'SYSTEM' OR
     profile_scope IS DISTINCT FROM (
       CASE WHEN NEW.level = 'PLATFORM' THEN 'PLATFORM_GRANT' ELSE 'PROVINCE_GRANT' END
     ) THEN
    RAISE EXCEPTION 'authority grant requires a matching system profile'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION access_control.authority_scope_contains(
  basis_grant_id uuid,
  child_grant_id uuid,
  expected_basis_subject_id uuid,
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
      FROM access_control.authority_grants basis
      JOIN access_control.authority_grants child ON child.id = child_grant_id
     WHERE basis.id = basis_grant_id
       AND basis.subject_user_id = expected_basis_subject_id
       AND basis.status = 'ACTIVE'
       AND basis.valid_from <= evaluated_at
       AND basis.expires_at > evaluated_at
       AND access_control.authority_chain_is_active(basis.id, evaluated_at)
       AND child.valid_from >= basis.valid_from
       AND child.expires_at <= basis.expires_at
       AND (basis.level = 'PLATFORM' OR child.level = 'PROVINCE')
       AND (NOT child.allows_pii OR basis.allows_pii)
       AND (NOT child.allows_document_content OR basis.allows_document_content)
       AND (NOT child.allows_export OR basis.allows_export)
       AND (NOT child.allows_intervention OR basis.allows_intervention)
       AND (
         basis.national_scope OR (
           NOT child.national_scope AND NOT EXISTS (
             SELECT 1
               FROM access_control.authority_grant_geographies child_geography
               LEFT JOIN access_control.authority_grant_geographies basis_geography
                 ON basis_geography.grant_id = basis.id
                AND basis_geography.geographic_unit_id = child_geography.geographic_unit_id
              WHERE child_geography.grant_id = child.id
                AND basis_geography.geographic_unit_id IS NULL
           )
         )
       )
       AND NOT EXISTS (
         SELECT 1
           FROM access_control.authority_grant_permissions child_permission
           LEFT JOIN access_control.authority_grant_permissions basis_permission
             ON basis_permission.grant_id = basis.id
            AND basis_permission.permission_code = child_permission.permission_code
          WHERE child_permission.grant_id = child.id
            AND basis_permission.permission_code IS NULL
       )
       AND NOT EXISTS (
         SELECT 1
           FROM access_control.authority_grant_resources child_resource
           LEFT JOIN access_control.authority_grant_resources basis_resource
             ON basis_resource.grant_id = basis.id
            AND basis_resource.resource_class = child_resource.resource_class
          WHERE child_resource.grant_id = child.id
            AND basis_resource.resource_class IS NULL
       )
  );
$function$;

CREATE OR REPLACE FUNCTION access_control.authority_grant_is_well_formed(selected_grant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM access_control.authority_grants child
     WHERE child.id = selected_grant_id
       AND EXISTS (
         SELECT 1 FROM identity.users subject_user
          WHERE subject_user.id = child.subject_user_id AND subject_user.status = 'ACTIVE'
       )
       AND EXISTS (
         SELECT 1 FROM access_control.authority_grant_permissions permission
          WHERE permission.grant_id = child.id
       )
       AND EXISTS (
         SELECT 1 FROM access_control.authority_grant_resources resource
          WHERE resource.grant_id = child.id
       )
       AND NOT EXISTS (
         SELECT 1
           FROM access_control.authority_grant_permissions child_permission
          WHERE child_permission.grant_id = child.id
            AND NOT EXISTS (
              SELECT 1
                FROM access_control.role_profile_roles profile_role
                JOIN access_control.roles role_record
                  ON role_record.id = profile_role.role_id AND role_record.active
                JOIN access_control.role_permissions role_permission
                  ON role_permission.role_id = role_record.id
                JOIN access_control.permissions permission
                  ON permission.code = role_permission.permission_code AND permission.active
               WHERE profile_role.profile_id = child.role_profile_id
                 AND permission.code = child_permission.permission_code
            )
       )
       AND (
         (child.national_scope AND child.level = 'PLATFORM' AND NOT EXISTS (
           SELECT 1 FROM access_control.authority_grant_geographies geography
            WHERE geography.grant_id = child.id
         )) OR
         (NOT child.national_scope AND EXISTS (
           SELECT 1 FROM access_control.authority_grant_geographies geography
            WHERE geography.grant_id = child.id
         ))
       )
       AND (
         child.parent_grant_id IS NULL OR
         access_control.authority_scope_contains(
           child.parent_grant_id,
           child.id,
           child.issued_by_user_id,
           child.created_at
         )
       )
       AND (
         child.approved_under_grant_id IS NULL OR
         access_control.authority_scope_contains(
           child.approved_under_grant_id,
           child.id,
           child.approved_by_user_id,
           child.approved_at
         )
       )
  );
$function$;

CREATE OR REPLACE FUNCTION access_control.enforce_authority_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  checked_grant_id uuid;
  checked_subject_user_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    checked_grant_id := COALESCE(
      (to_jsonb(OLD) ->> 'grant_id')::uuid,
      (to_jsonb(OLD) ->> 'id')::uuid
    );
  ELSE
    checked_grant_id := COALESCE(
      (to_jsonb(NEW) ->> 'grant_id')::uuid,
      (to_jsonb(NEW) ->> 'id')::uuid
    );
  END IF;
  SELECT subject_user_id INTO checked_subject_user_id
    FROM access_control.authority_grants WHERE id = checked_grant_id;
  IF checked_subject_user_id IS NOT NULL THEN
    PERFORM set_config('app.authority_target_user_id', checked_subject_user_id::text, true);
  END IF;
  IF checked_subject_user_id IS NOT NULL AND
     NOT access_control.authority_grant_is_well_formed(checked_grant_id) THEN
    RAISE EXCEPTION 'authority grant exceeds its profile, issuer, or approver scope'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION access_control.reject_authority_provenance_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF OLD.subject_user_id IS DISTINCT FROM NEW.subject_user_id OR
     OLD.issued_by_user_id IS DISTINCT FROM NEW.issued_by_user_id OR
     OLD.parent_grant_id IS DISTINCT FROM NEW.parent_grant_id OR
     OLD.role_profile_id IS DISTINCT FROM NEW.role_profile_id OR
     OLD.level IS DISTINCT FROM NEW.level OR
     OLD.national_scope IS DISTINCT FROM NEW.national_scope OR
     OLD.valid_from IS DISTINCT FROM NEW.valid_from OR
     OLD.expires_at IS DISTINCT FROM NEW.expires_at OR
     OLD.required_assurance IS DISTINCT FROM NEW.required_assurance OR
     OLD.allows_pii IS DISTINCT FROM NEW.allows_pii OR
     OLD.allows_document_content IS DISTINCT FROM NEW.allows_document_content OR
     OLD.allows_export IS DISTINCT FROM NEW.allows_export OR
     OLD.allows_intervention IS DISTINCT FROM NEW.allows_intervention THEN
    RAISE EXCEPTION 'authority grant provenance and scope cannot be changed'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.approved_by_user_id IS NOT NULL AND (
    OLD.approved_by_user_id IS DISTINCT FROM NEW.approved_by_user_id OR
    OLD.approved_under_grant_id IS DISTINCT FROM NEW.approved_under_grant_id OR
    OLD.approved_at IS DISTINCT FROM NEW.approved_at OR
    OLD.approval_reason IS DISTINCT FROM NEW.approval_reason
  ) THEN
    RAISE EXCEPTION 'authority approval evidence cannot be changed'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION access_control.enforce_assignment_scope_shape()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  checked_assignment_id uuid;
  assignment_scope varchar;
  facility_count integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    checked_assignment_id := COALESCE(
      (to_jsonb(OLD) ->> 'assignment_id')::uuid,
      (to_jsonb(OLD) ->> 'id')::uuid
    );
  ELSE
    checked_assignment_id := COALESCE(
      (to_jsonb(NEW) ->> 'assignment_id')::uuid,
      (to_jsonb(NEW) ->> 'id')::uuid
    );
  END IF;
  SELECT scope_type INTO assignment_scope
    FROM access_control.access_assignments WHERE id = checked_assignment_id;
  IF assignment_scope IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  SELECT count(*)::integer INTO facility_count
    FROM access_control.access_assignment_facilities
   WHERE assignment_id = checked_assignment_id;
  IF (assignment_scope = 'TENANT' AND facility_count <> 0) OR
     (assignment_scope = 'FACILITY_SET' AND facility_count = 0) THEN
    RAISE EXCEPTION 'assignment facility scope shape is invalid'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

CREATE TRIGGER role_permissions_owner_guard
  BEFORE INSERT OR UPDATE ON access_control.role_permissions
  FOR EACH ROW EXECUTE FUNCTION access_control.enforce_role_permission_owner();
CREATE TRIGGER role_profile_roles_owner_guard
  BEFORE INSERT OR UPDATE ON access_control.role_profile_roles
  FOR EACH ROW EXECUTE FUNCTION access_control.enforce_profile_role_owner();
CREATE TRIGGER access_assignments_owner_guard
  BEFORE INSERT OR UPDATE ON access_control.access_assignments
  FOR EACH ROW EXECUTE FUNCTION access_control.enforce_assignment_owner();
CREATE TRIGGER authority_grants_profile_guard
  BEFORE INSERT OR UPDATE OF role_profile_id, level ON access_control.authority_grants
  FOR EACH ROW EXECUTE FUNCTION access_control.enforce_authority_profile();
CREATE TRIGGER authority_grants_provenance_immutable
  BEFORE UPDATE ON access_control.authority_grants
  FOR EACH ROW EXECUTE FUNCTION access_control.reject_authority_provenance_change();
CREATE CONSTRAINT TRIGGER authority_grants_scope_guard
  AFTER INSERT OR UPDATE ON access_control.authority_grants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION access_control.enforce_authority_scope();
CREATE CONSTRAINT TRIGGER authority_grant_permissions_scope_guard
  AFTER INSERT OR UPDATE OR DELETE ON access_control.authority_grant_permissions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION access_control.enforce_authority_scope();
CREATE CONSTRAINT TRIGGER authority_grant_resources_scope_guard
  AFTER INSERT OR UPDATE OR DELETE ON access_control.authority_grant_resources
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION access_control.enforce_authority_scope();
CREATE CONSTRAINT TRIGGER authority_grant_geographies_scope_guard
  AFTER INSERT OR UPDATE OR DELETE ON access_control.authority_grant_geographies
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION access_control.enforce_authority_scope();
CREATE CONSTRAINT TRIGGER access_assignments_scope_shape_guard
  AFTER INSERT OR UPDATE ON access_control.access_assignments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION access_control.enforce_assignment_scope_shape();
CREATE CONSTRAINT TRIGGER access_assignment_facilities_scope_shape_guard
  AFTER INSERT OR UPDATE OR DELETE ON access_control.access_assignment_facilities
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION access_control.enforce_assignment_scope_shape();

CREATE TRIGGER facilities_ownership_immutable
  BEFORE UPDATE OF tenant_id ON tenancy.facilities
  FOR EACH ROW EXECUTE FUNCTION governance.reject_ownership_change();
CREATE TRIGGER memberships_ownership_immutable
  BEFORE UPDATE OF tenant_id ON tenancy.memberships
  FOR EACH ROW EXECUTE FUNCTION governance.reject_ownership_change();
CREATE TRIGGER roles_ownership_immutable
  BEFORE UPDATE OF tenant_id ON access_control.roles
  FOR EACH ROW EXECUTE FUNCTION governance.reject_ownership_change();
CREATE TRIGGER role_profiles_ownership_immutable
  BEFORE UPDATE OF tenant_id ON access_control.role_profiles
  FOR EACH ROW EXECUTE FUNCTION governance.reject_ownership_change();
CREATE TRIGGER access_assignments_ownership_immutable
  BEFORE UPDATE OF tenant_id ON access_control.access_assignments
  FOR EACH ROW EXECUTE FUNCTION governance.reject_ownership_change();

CREATE OR REPLACE FUNCTION access_control.resolve_tenant_context(
  subject_id uuid,
  requested_tenant_id uuid,
  evaluated_at timestamptz
)
RETURNS TABLE (
  assignment_id uuid,
  tenant_id uuid,
  profile_id uuid,
  profile_version integer,
  scope_type varchar,
  facility_ids uuid[],
  permission_codes text[],
  valid_until timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT aa.id,
         aa.tenant_id,
         rp.id,
         rp.version,
         aa.scope_type,
         COALESCE(
           (SELECT array_agg(aaf.facility_id ORDER BY aaf.facility_id)
              FROM access_control.access_assignment_facilities aaf
             WHERE aaf.assignment_id = aa.id),
           ARRAY[]::uuid[]
         ),
         COALESCE(
           (SELECT array_agg(DISTINCT p.code ORDER BY p.code)
              FROM access_control.role_profile_roles rpr
              JOIN access_control.roles r ON r.id = rpr.role_id AND r.active
              JOIN access_control.role_permissions rperm ON rperm.role_id = r.id
              JOIN access_control.permissions p ON p.code = rperm.permission_code AND p.active
             WHERE rpr.profile_id = rp.id),
           ARRAY[]::text[]
         ),
         aa.valid_until
    FROM access_control.access_assignments aa
    JOIN access_control.role_profiles rp ON rp.id = aa.role_profile_id AND rp.active
   WHERE aa.user_id = subject_id
     AND subject_id = governance.current_setting_uuid('app.user_id')
     AND aa.tenant_id = requested_tenant_id
     AND aa.status = 'ACTIVE'
     AND aa.valid_from <= evaluated_at
     AND aa.valid_until > evaluated_at
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION access_control.facility_allowed(
  subject_id uuid,
  requested_tenant_id uuid,
  requested_facility_id uuid,
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
      FROM access_control.access_assignments aa
      JOIN tenancy.facilities f
        ON f.tenant_id = aa.tenant_id AND f.id = requested_facility_id
     WHERE aa.user_id = subject_id
       AND subject_id = governance.current_setting_uuid('app.user_id')
       AND aa.tenant_id = requested_tenant_id
       AND aa.status = 'ACTIVE'
       AND aa.valid_from <= evaluated_at
       AND aa.valid_until > evaluated_at
       AND (
         aa.scope_type = 'TENANT' OR EXISTS (
           SELECT 1 FROM access_control.access_assignment_facilities aaf
            WHERE aaf.assignment_id = aa.id AND aaf.facility_id = requested_facility_id
         )
       )
  );
$function$;

CREATE OR REPLACE FUNCTION access_control.resolve_authority_context(
  subject_id uuid,
  requested_grant_id uuid,
  evaluated_at timestamptz
)
RETURNS TABLE (
  grant_id uuid,
  level varchar,
  permission_codes text[],
  resource_classes text[],
  geographic_unit_ids uuid[],
  purpose varchar,
  allows_pii boolean,
  allows_document_content boolean,
  allows_export boolean,
  allows_intervention boolean,
  required_assurance varchar,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT ag.id,
         ag.level,
         COALESCE(
           (SELECT array_agg(DISTINCT gp.permission_code ORDER BY gp.permission_code)
              FROM access_control.authority_grant_permissions gp
             WHERE gp.grant_id = ag.id
               AND EXISTS (
                 SELECT 1
                   FROM access_control.role_profile_roles rpr
                   JOIN access_control.roles r ON r.id = rpr.role_id AND r.active
                   JOIN access_control.role_permissions rp ON rp.role_id = r.id
                   JOIN access_control.permissions p ON p.code = rp.permission_code AND p.active
                  WHERE rpr.profile_id = ag.role_profile_id
                    AND p.code = gp.permission_code
               )),
           ARRAY[]::text[]
         ),
         COALESCE(
           (SELECT array_agg(gr.resource_class ORDER BY gr.resource_class)
              FROM access_control.authority_grant_resources gr WHERE gr.grant_id = ag.id),
           ARRAY[]::text[]
         ),
         COALESCE(
           (SELECT array_agg(gg.geographic_unit_id ORDER BY gg.geographic_unit_id)
              FROM access_control.authority_grant_geographies gg WHERE gg.grant_id = ag.id),
           ARRAY[]::uuid[]
         ),
         ag.purpose,
         ag.allows_pii,
         ag.allows_document_content,
         ag.allows_export,
         ag.allows_intervention,
         ag.required_assurance,
         ag.expires_at
    FROM access_control.authority_grants ag
   WHERE ag.id = requested_grant_id
     AND ag.subject_user_id = subject_id
     AND subject_id = governance.current_setting_uuid('app.user_id')
     AND ag.status = 'ACTIVE'
     AND ag.valid_from <= evaluated_at
     AND ag.expires_at > evaluated_at
     AND access_control.authority_chain_is_active(ag.id, evaluated_at)
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION access_control.list_tenant_contexts(
  subject_id uuid,
  evaluated_at timestamptz
)
RETURNS TABLE (
  assignment_id uuid,
  tenant_id uuid,
  tenant_name varchar,
  profile_id uuid,
  profile_name varchar,
  profile_version integer,
  scope_type varchar,
  facility_ids uuid[],
  valid_until timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT aa.id,
         aa.tenant_id,
         po.display_name,
         rp.id,
         rp.name,
         rp.version,
         aa.scope_type,
         COALESCE(
           (SELECT array_agg(aaf.facility_id ORDER BY aaf.facility_id)
              FROM access_control.access_assignment_facilities aaf
             WHERE aaf.assignment_id = aa.id),
           ARRAY[]::uuid[]
         ),
         aa.valid_until
    FROM access_control.access_assignments aa
    JOIN tenancy.provider_organizations po ON po.id = aa.tenant_id
    JOIN access_control.role_profiles rp ON rp.id = aa.role_profile_id AND rp.active
   WHERE aa.user_id = subject_id
     AND subject_id = governance.current_setting_uuid('app.user_id')
     AND aa.status = 'ACTIVE'
     AND aa.valid_from <= evaluated_at
     AND aa.valid_until > evaluated_at
   ORDER BY po.display_name, aa.id;
$function$;

CREATE OR REPLACE FUNCTION access_control.list_authority_contexts(
  subject_id uuid,
  evaluated_at timestamptz
)
RETURNS TABLE (grant_id uuid, level varchar, purpose varchar, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT ag.id, ag.level, ag.purpose, ag.expires_at
    FROM access_control.authority_grants ag
   WHERE ag.subject_user_id = subject_id
     AND subject_id = governance.current_setting_uuid('app.user_id')
     AND ag.status = 'ACTIVE'
     AND ag.valid_from <= evaluated_at
     AND ag.expires_at > evaluated_at
     AND access_control.authority_chain_is_active(ag.id, evaluated_at)
   ORDER BY ag.expires_at, ag.id;
$function$;

CREATE OR REPLACE FUNCTION access_control.invalidate_credentials_after_assignment_revocation(
  selected_assignment_id uuid,
  selected_subject_user_id uuid,
  revoked_at_value timestamptz
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  acting_user_id uuid;
  selected_tenant_id uuid;
BEGIN
  acting_user_id := governance.current_setting_uuid('app.user_id');
  selected_tenant_id := governance.current_setting_uuid('app.tenant_id');
  IF acting_user_id IS NULL OR selected_tenant_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM access_control.access_assignments assignment
     WHERE assignment.id = selected_assignment_id
       AND assignment.tenant_id = selected_tenant_id
       AND assignment.user_id = selected_subject_user_id
       AND assignment.status = 'REVOKED'
       AND assignment.revoked_by = acting_user_id
       AND assignment.revoked_at = revoked_at_value
  ) THEN
    RAISE EXCEPTION 'credential invalidation requires a matching assignment revocation'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.access_revocation_user_id', selected_subject_user_id::text, true);
  UPDATE identity.users
     SET token_version = token_version + 1, updated_at = revoked_at_value
   WHERE id = selected_subject_user_id;
  UPDATE identity.auth_sessions
     SET revoked_at = COALESCE(revoked_at, revoked_at_value),
         revocation_reason = COALESCE(revocation_reason, 'ACCESS_ASSIGNMENT_REVOKED'),
         session_version = session_version + CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END,
         updated_at = revoked_at_value
   WHERE user_id = selected_subject_user_id;
  UPDATE identity.refresh_tokens token
     SET revoked_at = COALESCE(token.revoked_at, revoked_at_value),
         revocation_reason = COALESCE(token.revocation_reason, 'ACCESS_ASSIGNMENT_REVOKED')
   WHERE EXISTS (
     SELECT 1 FROM identity.auth_sessions session
      WHERE session.id = token.session_id AND session.user_id = selected_subject_user_id
   );
END;
$function$;

CREATE OR REPLACE FUNCTION access_control.invalidate_credentials_after_authority_revocation(
  selected_grant_id uuid,
  selected_subject_user_id uuid,
  revoked_at_value timestamptz
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  acting_user_id uuid;
BEGIN
  acting_user_id := governance.current_setting_uuid('app.user_id');
  IF acting_user_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM access_control.authority_grants grant_record
     WHERE grant_record.id = selected_grant_id
       AND grant_record.subject_user_id = selected_subject_user_id
       AND grant_record.status = 'REVOKED'
       AND grant_record.revoked_by = acting_user_id
       AND grant_record.revoked_at = revoked_at_value
  ) THEN
    RAISE EXCEPTION 'credential invalidation requires a matching authority revocation'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.access_revocation_user_id', selected_subject_user_id::text, true);
  UPDATE identity.users
     SET token_version = token_version + 1, updated_at = revoked_at_value
   WHERE id = selected_subject_user_id;
END;
$function$;

DROP POLICY audit_events_tenant_policy ON governance.audit_events;
CREATE POLICY audit_events_scoped_select_policy ON governance.audit_events
  FOR SELECT TO PUBLIC
  USING (
    (tenant_id IS NOT NULL AND tenant_id = governance.current_setting_uuid('app.tenant_id')) OR
    (
      tenant_id IS NULL AND actor_id IS NOT NULL AND
      actor_id IN (
        governance.current_setting_uuid('app.user_id'),
        governance.current_setting_uuid('app.authentication_user_id')
      )
    )
  );

DROP POLICY audit_events_tenant_insert_policy ON governance.audit_events;
CREATE POLICY audit_events_scoped_insert_policy ON governance.audit_events
  FOR INSERT TO PUBLIC
  WITH CHECK (
    (tenant_id IS NOT NULL AND tenant_id = governance.current_setting_uuid('app.tenant_id')) OR
    (tenant_id IS NULL AND actor_id = governance.current_setting_uuid('app.user_id')) OR
    (
      tenant_id IS NULL AND actor_type = 'USER' AND action LIKE 'authentication.%' AND
      actor_id = governance.current_setting_uuid('app.authentication_user_id')
    ) OR
    (tenant_id IS NULL AND actor_type = 'SYSTEM_POLICY')
  );

INSERT INTO geography.geographic_units
  (id, parent_id, level, code, name_en, name_ne, created_at, updated_at)
VALUES
  ('019a45f0-0000-7000-8000-000000000001', NULL, 'COUNTRY', 'NP', 'Nepal', 'नेपाल', now(), now()),
  ('019a45f0-0000-7000-8000-000000000101', '019a45f0-0000-7000-8000-000000000001', 'PROVINCE', 'P1', 'Koshi Province', 'कोशी प्रदेश', now(), now()),
  ('019a45f0-0000-7000-8000-000000000102', '019a45f0-0000-7000-8000-000000000001', 'PROVINCE', 'P2', 'Madhesh Province', 'मधेश प्रदेश', now(), now()),
  ('019a45f0-0000-7000-8000-000000000103', '019a45f0-0000-7000-8000-000000000001', 'PROVINCE', 'P3', 'Bagmati Province', 'बागमती प्रदेश', now(), now()),
  ('019a45f0-0000-7000-8000-000000000104', '019a45f0-0000-7000-8000-000000000001', 'PROVINCE', 'P4', 'Gandaki Province', 'गण्डकी प्रदेश', now(), now()),
  ('019a45f0-0000-7000-8000-000000000105', '019a45f0-0000-7000-8000-000000000001', 'PROVINCE', 'P5', 'Lumbini Province', 'लुम्बिनी प्रदेश', now(), now()),
  ('019a45f0-0000-7000-8000-000000000106', '019a45f0-0000-7000-8000-000000000001', 'PROVINCE', 'P6', 'Karnali Province', 'कर्णाली प्रदेश', now(), now()),
  ('019a45f0-0000-7000-8000-000000000107', '019a45f0-0000-7000-8000-000000000001', 'PROVINCE', 'P7', 'Sudurpashchim Province', 'सुदूरपश्चिम प्रदेश', now(), now());

INSERT INTO access_control.permissions
  (code, description, resource, action, risk_class, created_at)
VALUES
  ('access.assignment.read', 'Read scoped access assignments', 'access_assignment', 'read', 'MEDIUM', now()),
  ('access.assignment.manage', 'Grant and revoke scoped access assignments', 'access_assignment', 'manage', 'HIGH', now()),
  ('access.role.read', 'Read roles and role profiles', 'role', 'read', 'MEDIUM', now()),
  ('access.role.manage', 'Create, update, and retire roles and profiles', 'role', 'manage', 'HIGH', now()),
  ('access.authority.grant', 'Issue and revoke authority grants', 'authority_grant', 'manage', 'CRITICAL', now()),
  ('provider.read', 'Read provider projections', 'provider', 'read', 'LOW', now()),
  ('provider.review', 'Review provider applications', 'provider', 'review', 'HIGH', now()),
  ('provider.suspend', 'Suspend provider operations', 'provider', 'suspend', 'CRITICAL', now()),
  ('facility.read', 'Read scoped facilities', 'facility', 'read', 'LOW', now()),
  ('facility.manage', 'Manage scoped facilities', 'facility', 'manage', 'HIGH', now()),
  ('driver.read', 'Read scoped drivers', 'driver', 'read', 'LOW', now()),
  ('driver.manage', 'Manage scoped driver operations', 'driver', 'manage', 'MEDIUM', now()),
  ('driver.verify', 'Review driver affiliation and evidence', 'driver', 'verify', 'HIGH', now()),
  ('driver.suspend', 'Suspend a driver account', 'driver', 'suspend', 'HIGH', now()),
  ('ambulance.read', 'Read scoped ambulances', 'ambulance', 'read', 'LOW', now()),
  ('ambulance.manage', 'Manage ordinary ambulance attributes', 'ambulance', 'manage', 'MEDIUM', now()),
  ('ambulance.status.change', 'Change ambulance operational status', 'ambulance', 'status_change', 'HIGH', now()),
  ('maintenance.read', 'Read maintenance history', 'maintenance', 'read', 'LOW', now()),
  ('maintenance.manage', 'Manage maintenance records', 'maintenance', 'manage', 'MEDIUM', now()),
  ('document.metadata.read', 'Read document metadata', 'document', 'metadata_read', 'MEDIUM', now()),
  ('document.content.read', 'Read restricted document content', 'document', 'content_read', 'HIGH', now()),
  ('document.upload', 'Upload scoped document evidence', 'document', 'upload', 'MEDIUM', now()),
  ('document.review', 'Review scoped documents', 'document', 'review', 'HIGH', now()),
  ('document.invalidate', 'Invalidate approved evidence', 'document', 'invalidate', 'HIGH', now()),
  ('booking.read', 'Read relationship-scoped bookings', 'booking', 'read', 'LOW', now()),
  ('booking.create', 'Create a patient booking', 'booking', 'create', 'MEDIUM', now()),
  ('booking.cancel', 'Cancel an allowed booking', 'booking', 'cancel', 'MEDIUM', now()),
  ('dispatch.offer.read', 'Read scoped dispatch offers', 'dispatch_offer', 'read', 'LOW', now()),
  ('dispatch.respond', 'Accept or decline a dispatch offer', 'dispatch_offer', 'respond', 'HIGH', now()),
  ('dispatch.override', 'Intervene in dispatch', 'dispatch', 'override', 'CRITICAL', now()),
  ('trip.read', 'Read relationship-scoped trips', 'trip', 'read', 'LOW', now()),
  ('trip.transition', 'Perform an allowed trip transition', 'trip', 'transition', 'HIGH', now()),
  ('trip.cancel', 'Cancel an allowed trip', 'trip', 'cancel', 'HIGH', now()),
  ('tracking.read', 'Read authorized trip tracking', 'tracking', 'read', 'MEDIUM', now()),
  ('tracking.publish', 'Publish assigned trip tracking', 'tracking', 'publish', 'MEDIUM', now()),
  ('safety.incident.read', 'Read scoped safety incidents', 'safety_incident', 'read', 'MEDIUM', now()),
  ('safety.sos.create', 'Create a safety incident', 'safety_incident', 'create', 'HIGH', now()),
  ('safety.incident.manage', 'Acknowledge, escalate, and resolve incidents', 'safety_incident', 'manage', 'HIGH', now()),
  ('support.ticket.read', 'Read scoped support tickets', 'support_ticket', 'read', 'LOW', now()),
  ('support.ticket.create', 'Create support tickets', 'support_ticket', 'create', 'LOW', now()),
  ('support.ticket.manage', 'Manage support tickets', 'support_ticket', 'manage', 'MEDIUM', now()),
  ('support.escalate', 'Escalate support tickets', 'support_ticket', 'escalate', 'HIGH', now()),
  ('report.tenant.read', 'Read tenant reports', 'report', 'tenant_read', 'MEDIUM', now()),
  ('report.province.read', 'Read province reports', 'report', 'province_read', 'MEDIUM', now()),
  ('report.export', 'Export approved report data', 'report', 'export', 'HIGH', now()),
  ('audit.read', 'Read approved audit projections', 'audit', 'read', 'HIGH', now()),
  ('audit.export', 'Export approved audit evidence', 'audit', 'export', 'CRITICAL', now()),
  ('session.revoke', 'Revoke user sessions under an approved support case', 'session', 'revoke', 'HIGH', now()),
  ('breakglass.activate', 'Activate time-bounded emergency access', 'breakglass', 'activate', 'CRITICAL', now()),
  ('fare.read', 'Read fare quote and receipt projections', 'fare', 'read', 'LOW', now()),
  ('ledger.read', 'Read scoped finance ledger projections', 'ledger', 'read', 'HIGH', now()),
  ('cash.record', 'Record and reconcile cash collection', 'cash_collection', 'record', 'HIGH', now()),
  ('payment.refund', 'Request or approve a payment refund', 'payment', 'refund', 'CRITICAL', now()),
  ('settlement.manage', 'Manage provider settlement', 'settlement', 'manage', 'CRITICAL', now());

INSERT INTO access_control.roles
  (id, owner_type, tenant_id, name, description, created_at, updated_at)
VALUES
  ('019a45f0-0000-7000-8100-000000000001', 'SYSTEM', NULL, 'Patient Self', 'Patient self-service actions', now(), now()),
  ('019a45f0-0000-7000-8100-000000000002', 'SYSTEM', NULL, 'Driver Crew', 'Assigned driver and crew actions', now(), now()),
  ('019a45f0-0000-7000-8100-000000000003', 'SYSTEM', NULL, 'Facility Dispatcher', 'Facility dispatch operations', now(), now()),
  ('019a45f0-0000-7000-8100-000000000004', 'SYSTEM', NULL, 'Facility Fleet Manager', 'Fleet, maintenance, and document operations', now(), now()),
  ('019a45f0-0000-7000-8100-000000000005', 'SYSTEM', NULL, 'Facility Administrator', 'Tenant access and facility administration', now(), now()),
  ('019a45f0-0000-7000-8100-000000000006', 'SYSTEM', NULL, 'Provincial Reviewer', 'Provider and document review', now(), now()),
  ('019a45f0-0000-7000-8100-000000000007', 'SYSTEM', NULL, 'Provincial Monitor', 'Operational monitoring and reporting', now(), now()),
  ('019a45f0-0000-7000-8100-000000000008', 'SYSTEM', NULL, 'Platform Support', 'Purpose-bound platform support', now(), now()),
  ('019a45f0-0000-7000-8100-000000000009', 'SYSTEM', NULL, 'Platform Auditor', 'Immutable audit and reporting reads', now(), now()),
  ('019a45f0-0000-7000-8100-000000000010', 'SYSTEM', NULL, 'Platform Security Owner', 'High-risk access and security administration', now(), now());

INSERT INTO access_control.role_permissions(role_id, permission_code, tenant_id, created_at)
SELECT r.id, p.code, NULL, now()
FROM access_control.roles r
JOIN access_control.permissions p ON
  (r.name = 'Patient Self' AND p.code IN ('booking.create','booking.read','booking.cancel','fare.read','safety.sos.create','support.ticket.create','support.ticket.read')) OR
  (r.name = 'Driver Crew' AND p.code IN ('driver.read','trip.read','trip.transition','trip.cancel','tracking.read','tracking.publish','safety.sos.create','safety.incident.read')) OR
  (r.name = 'Facility Dispatcher' AND p.code IN ('facility.read','driver.read','ambulance.read','booking.read','dispatch.offer.read','dispatch.respond','trip.read','trip.transition','trip.cancel','tracking.read','safety.incident.read','safety.incident.manage','cash.record')) OR
  (r.name = 'Facility Fleet Manager' AND p.code IN ('facility.read','driver.read','driver.manage','ambulance.read','ambulance.manage','ambulance.status.change','maintenance.read','maintenance.manage','document.metadata.read','document.content.read','document.upload')) OR
  (r.name = 'Facility Administrator' AND p.code IN ('provider.read','facility.read','facility.manage','access.assignment.read','access.assignment.manage','access.role.read','access.role.manage','report.tenant.read')) OR
  (r.name = 'Provincial Reviewer' AND p.code IN ('provider.read','provider.review','facility.read','document.metadata.read','document.content.read','document.review','driver.read','ambulance.read')) OR
  (r.name = 'Provincial Monitor' AND p.code IN ('provider.read','facility.read','driver.read','ambulance.read','booking.read','trip.read','tracking.read','safety.incident.read','report.province.read','support.ticket.read','support.escalate')) OR
  (r.name = 'Platform Support' AND p.code IN ('support.ticket.read','support.ticket.manage','support.escalate','session.revoke')) OR
  (r.name = 'Platform Auditor' AND p.code IN ('audit.read','report.province.read','report.export')) OR
  (r.name = 'Platform Security Owner' AND p.code IN ('access.assignment.read','access.assignment.manage','access.role.read','access.role.manage','access.authority.grant','audit.read','audit.export','session.revoke','breakglass.activate'));

INSERT INTO access_control.role_profiles
  (id, owner_type, tenant_id, name, description, scope_ceiling, created_at, updated_at)
VALUES
  ('019a45f0-0000-7000-8200-000000000001', 'SYSTEM', NULL, 'Patient Self', 'Patient self-service profile', 'SELF', now(), now()),
  ('019a45f0-0000-7000-8200-000000000002', 'SYSTEM', NULL, 'Driver/Crew', 'Assigned driver and crew profile', 'ASSIGNED_TRIP', now(), now()),
  ('019a45f0-0000-7000-8200-000000000003', 'SYSTEM', NULL, 'Facility Dispatcher', 'Facility dispatcher profile', 'FACILITY_SET', now(), now()),
  ('019a45f0-0000-7000-8200-000000000004', 'SYSTEM', NULL, 'Facility Fleet Manager', 'Facility fleet manager profile', 'FACILITY_SET', now(), now()),
  ('019a45f0-0000-7000-8200-000000000005', 'SYSTEM', NULL, 'Facility Administrator', 'Tenant administrator profile', 'TENANT', now(), now()),
  ('019a45f0-0000-7000-8200-000000000006', 'SYSTEM', NULL, 'Provincial Reviewer', 'Province review profile', 'PROVINCE_GRANT', now(), now()),
  ('019a45f0-0000-7000-8200-000000000007', 'SYSTEM', NULL, 'Provincial Monitor', 'Province monitor profile', 'PROVINCE_GRANT', now(), now()),
  ('019a45f0-0000-7000-8200-000000000008', 'SYSTEM', NULL, 'Platform Support', 'Purpose-bound platform support profile', 'PLATFORM_GRANT', now(), now()),
  ('019a45f0-0000-7000-8200-000000000009', 'SYSTEM', NULL, 'Platform Auditor', 'Platform audit profile', 'PLATFORM_GRANT', now(), now()),
  ('019a45f0-0000-7000-8200-000000000010', 'SYSTEM', NULL, 'Platform Security Owner', 'Platform security administration profile', 'PLATFORM_GRANT', now(), now());

INSERT INTO access_control.role_profile_roles(profile_id, role_id, tenant_id, created_at)
SELECT p.id, r.id, NULL, now()
FROM access_control.role_profiles p
JOIN access_control.roles r ON r.name = p.name OR (p.name = 'Driver/Crew' AND r.name = 'Driver Crew');

REVOKE ALL ON ALL TABLES IN SCHEMA geography FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA identity FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA tenancy FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA access_control FROM PUBLIC;

REVOKE ALL ON FUNCTION governance.current_setting_uuid(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION governance.current_setting_uuid_array(text) FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA access_control FROM PUBLIC;

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resq_application') THEN
    GRANT USAGE ON SCHEMA geography, identity, tenancy, access_control TO resq_application;
    GRANT EXECUTE ON FUNCTION governance.current_setting_uuid_array(text) TO resq_application;
    GRANT EXECUTE ON FUNCTION access_control.resolve_tenant_context(uuid, uuid, timestamptz),
      access_control.facility_allowed(uuid, uuid, uuid, timestamptz),
       access_control.resolve_authority_context(uuid, uuid, timestamptz),
       access_control.list_tenant_contexts(uuid, timestamptz),
       access_control.list_authority_contexts(uuid, timestamptz),
       access_control.can_administer_authority(uuid, uuid, timestamptz),
       access_control.authority_target_user_is_active(uuid, timestamptz),
       access_control.invalidate_credentials_after_assignment_revocation(uuid, uuid, timestamptz),
       access_control.invalidate_credentials_after_authority_revocation(uuid, uuid, timestamptz)
       TO resq_application;
    GRANT SELECT ON geography.geographic_units, access_control.permissions TO resq_application;
    GRANT SELECT, INSERT, UPDATE ON identity.users, identity.user_profiles, identity.auth_identities,
      identity.otp_challenges, identity.auth_sessions, identity.refresh_tokens,
      identity.mfa_factors, identity.mfa_challenges TO resq_application;
    GRANT SELECT, INSERT, UPDATE ON tenancy.provider_organizations, tenancy.facilities,
      tenancy.memberships TO resq_application;
    GRANT SELECT, INSERT, UPDATE ON access_control.roles, access_control.role_permissions,
      access_control.role_profiles, access_control.role_profile_roles,
      access_control.access_assignments, access_control.access_assignment_facilities,
      access_control.authority_grants TO resq_application;
    GRANT SELECT, INSERT ON access_control.authority_grant_permissions,
      access_control.authority_grant_resources, access_control.authority_grant_geographies,
      access_control.authority_grant_provider_inclusions,
      access_control.authority_grant_provider_exclusions TO resq_application;
    GRANT DELETE ON access_control.role_permissions, access_control.role_profile_roles
      TO resq_application;
    EXECUTE $policy$CREATE POLICY otp_challenges_auth_service_policy
      ON identity.otp_challenges TO resq_application
      USING (id = governance.current_setting_uuid('app.authentication_challenge_id'))
      WITH CHECK (id = governance.current_setting_uuid('app.authentication_challenge_id'))$policy$;
    EXECUTE $policy$CREATE POLICY users_auth_service_policy
      ON identity.users TO resq_application
      USING (id = governance.current_setting_uuid('app.authentication_user_id'))
      WITH CHECK (id = governance.current_setting_uuid('app.authentication_user_id'))$policy$;
    EXECUTE $policy$CREATE POLICY user_profiles_auth_service_policy
      ON identity.user_profiles TO resq_application
      USING (user_id = governance.current_setting_uuid('app.authentication_user_id'))
      WITH CHECK (user_id = governance.current_setting_uuid('app.authentication_user_id'))$policy$;
    EXECUTE $policy$CREATE POLICY auth_identities_service_policy
      ON identity.auth_identities TO resq_application
      USING (
        user_id = governance.current_setting_uuid('app.authentication_user_id') OR
        normalized_identifier = current_setting('app.authentication_identifier', true)
      )
      WITH CHECK (user_id = governance.current_setting_uuid('app.authentication_user_id'))$policy$;
    EXECUTE $policy$CREATE POLICY auth_sessions_service_policy
      ON identity.auth_sessions TO resq_application
      USING (
        user_id = governance.current_setting_uuid('app.authentication_user_id') OR
        id = governance.current_setting_uuid('app.authentication_session_id')
      )
      WITH CHECK (
        user_id = governance.current_setting_uuid('app.authentication_user_id') OR
        id = governance.current_setting_uuid('app.authentication_session_id')
      )$policy$;
    EXECUTE $policy$CREATE POLICY refresh_tokens_auth_service_policy
      ON identity.refresh_tokens TO resq_application
      USING (
        encode(token_digest, 'hex') = current_setting('app.refresh_token_digest', true) OR
        session_id = governance.current_setting_uuid('app.authentication_session_id') OR
        family_id = governance.current_setting_uuid('app.authentication_family_id')
      )
      WITH CHECK (
        session_id = governance.current_setting_uuid('app.authentication_session_id')
      )$policy$;
    EXECUTE $policy$CREATE POLICY mfa_challenges_auth_service_policy
      ON identity.mfa_challenges TO resq_application
      USING (
        user_id = governance.current_setting_uuid('app.authentication_user_id') OR
        id = governance.current_setting_uuid('app.authentication_challenge_id')
      )
      WITH CHECK (user_id = governance.current_setting_uuid('app.authentication_user_id'))$policy$;
    EXECUTE $policy$CREATE POLICY mfa_factors_auth_service_policy
      ON identity.mfa_factors TO resq_application
      USING (user_id = governance.current_setting_uuid('app.authentication_user_id'))
      WITH CHECK (user_id = governance.current_setting_uuid('app.authentication_user_id'))$policy$;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resq_worker') THEN
    GRANT USAGE ON SCHEMA geography, identity, tenancy, access_control TO resq_worker;
    GRANT EXECUTE ON FUNCTION governance.current_setting_uuid_array(text) TO resq_worker;
    GRANT EXECUTE ON FUNCTION access_control.resolve_tenant_context(uuid, uuid, timestamptz),
       access_control.facility_allowed(uuid, uuid, uuid, timestamptz),
       access_control.resolve_authority_context(uuid, uuid, timestamptz),
       access_control.can_administer_authority(uuid, uuid, timestamptz) TO resq_worker;
    GRANT SELECT ON geography.geographic_units, access_control.permissions TO resq_worker;
    GRANT SELECT ON identity.users, tenancy.provider_organizations, tenancy.facilities,
      access_control.roles, access_control.role_permissions, access_control.role_profiles,
      access_control.role_profile_roles, access_control.access_assignments,
      access_control.access_assignment_facilities, access_control.authority_grants,
      access_control.authority_grant_permissions, access_control.authority_grant_resources,
      access_control.authority_grant_geographies TO resq_worker;
  END IF;
END;
$roles$;
`;

export class CreateIdentityAccess1793664000002 implements MigrationInterface {
  readonly name = 'CreateIdentityAccess1793664000002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(IDENTITY_ACCESS_SQL);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Production migrations are forward-only; use a reviewed compensating migration'),
    );
  }
}
