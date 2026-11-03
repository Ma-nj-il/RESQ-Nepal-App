import type { MigrationInterface, QueryRunner } from 'typeorm';

export const GOVERNANCE_CONTROL_SQL = String.raw`
CREATE SCHEMA IF NOT EXISTS governance;
REVOKE ALL ON SCHEMA governance FROM PUBLIC;

CREATE OR REPLACE FUNCTION governance.current_setting_uuid(setting_name text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
DECLARE
  raw_value text;
BEGIN
  raw_value := current_setting(setting_name, true);
  IF raw_value IS NULL OR raw_value = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw_value::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION governance.reject_row_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'append-only row cannot be updated or deleted'
    USING ERRCODE = '42501';
END;
$function$;

CREATE TABLE governance.schema_migration_runs (
  id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  release_id varchar(128) NOT NULL,
  operator_ref varchar(256) NOT NULL,
  expected_current varchar(256),
  current_before varchar(256) NOT NULL,
  current_after varchar(256) NOT NULL,
  applied_migrations jsonb NOT NULL,
  migration_checksums jsonb NOT NULL,
  result varchar(16) NOT NULL,
  error_code varchar(128),
  CONSTRAINT schema_migration_runs_time_order CHECK (finished_at >= started_at),
  CONSTRAINT schema_migration_runs_applied_array CHECK (jsonb_typeof(applied_migrations) = 'array'),
  CONSTRAINT schema_migration_runs_checksums_object CHECK (jsonb_typeof(migration_checksums) = 'object'),
  CONSTRAINT schema_migration_runs_result CHECK (result IN ('SUCCEEDED', 'FAILED')),
  CONSTRAINT schema_migration_runs_error_shape CHECK (
    (result = 'SUCCEEDED' AND error_code IS NULL) OR
    (result = 'FAILED' AND error_code IS NOT NULL)
  )
);
REVOKE ALL ON governance.schema_migration_runs FROM PUBLIC;

CREATE TABLE governance.audit_events (
  occurred_at timestamptz NOT NULL,
  id uuid NOT NULL,
  tenant_id uuid,
  actor_type varchar(32) NOT NULL,
  actor_id uuid,
  session_id uuid,
  authority_grant_id uuid,
  authentication_assurance varchar(32),
  action varchar(160) NOT NULL,
  resource_type varchar(96) NOT NULL,
  resource_id uuid,
  outcome varchar(16) NOT NULL,
  reason_code varchar(128) NOT NULL,
  correlation_id varchar(128) NOT NULL,
  causation_id varchar(128),
  trace_id varchar(64),
  source_channel varchar(32) NOT NULL,
  safe_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_hash bytea,
  event_hash bytea NOT NULL,
  retention_class varchar(64) NOT NULL,
  PRIMARY KEY (occurred_at, id),
  CONSTRAINT audit_actor_type CHECK (actor_type IN ('USER', 'WORKLOAD', 'SYSTEM_POLICY', 'BREAK_GLASS')),
  CONSTRAINT audit_outcome CHECK (outcome IN ('ALLOWED', 'DENIED', 'FAILED')),
  CONSTRAINT audit_source_channel CHECK (source_channel IN ('HTTP', 'WEBSOCKET', 'EVENT', 'JOB', 'MIGRATION', 'SYSTEM')),
  CONSTRAINT audit_safe_context_object CHECK (jsonb_typeof(safe_context) = 'object'),
  CONSTRAINT audit_event_hash_length CHECK (octet_length(event_hash) = 32),
  CONSTRAINT audit_previous_hash_length CHECK (previous_hash IS NULL OR octet_length(previous_hash) = 32),
  CONSTRAINT audit_actor_shape CHECK (
    (actor_type IN ('USER', 'WORKLOAD', 'BREAK_GLASS') AND actor_id IS NOT NULL) OR
    (actor_type = 'SYSTEM_POLICY')
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE governance.audit_events_default
  PARTITION OF governance.audit_events DEFAULT;

CREATE INDEX audit_events_tenant_time_idx
  ON governance.audit_events (tenant_id, occurred_at DESC, id);
CREATE INDEX audit_events_resource_time_idx
  ON governance.audit_events (resource_type, resource_id, occurred_at DESC);
CREATE INDEX audit_events_correlation_idx
  ON governance.audit_events (correlation_id, occurred_at DESC);

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON governance.audit_events
  FOR EACH ROW EXECUTE FUNCTION governance.reject_row_mutation();

ALTER TABLE governance.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_events_tenant_policy ON governance.audit_events
  FOR SELECT TO PUBLIC
  USING (tenant_id IS NOT NULL AND tenant_id = governance.current_setting_uuid('app.tenant_id'));
CREATE POLICY audit_events_tenant_insert_policy ON governance.audit_events
  FOR INSERT TO PUBLIC
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = governance.current_setting_uuid('app.tenant_id'));

CREATE TABLE governance.idempotency_records (
  id uuid PRIMARY KEY,
  tenant_id uuid,
  actor_id uuid NOT NULL,
  operation varchar(200) NOT NULL,
  idempotency_key_hash bytea NOT NULL,
  request_hash bytea NOT NULL,
  state varchar(24) NOT NULL,
  response_status integer,
  response_body jsonb,
  error_code varchar(128),
  locked_until timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE NULLS NOT DISTINCT (tenant_id, actor_id, operation, idempotency_key_hash),
  CONSTRAINT idempotency_key_hash_length CHECK (octet_length(idempotency_key_hash) = 32),
  CONSTRAINT idempotency_request_hash_length CHECK (octet_length(request_hash) = 32),
  CONSTRAINT idempotency_state CHECK (state IN ('IN_PROGRESS', 'COMPLETED', 'FAILED_RETRYABLE')),
  CONSTRAINT idempotency_response_status CHECK (
    response_status IS NULL OR response_status BETWEEN 100 AND 599
  ),
  CONSTRAINT idempotency_completion_shape CHECK (
    (state = 'IN_PROGRESS' AND response_status IS NULL AND response_body IS NULL AND error_code IS NULL) OR
    (state = 'COMPLETED' AND response_status IS NOT NULL AND error_code IS NULL) OR
    (state = 'FAILED_RETRYABLE' AND error_code IS NOT NULL)
  ),
  CONSTRAINT idempotency_time_order CHECK (updated_at >= created_at AND expires_at > created_at)
);

CREATE INDEX idempotency_records_expiry_idx ON governance.idempotency_records (expires_at);
CREATE INDEX idempotency_records_in_progress_idx
  ON governance.idempotency_records (locked_until)
  WHERE state = 'IN_PROGRESS';

ALTER TABLE governance.idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.idempotency_records FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_records_scope_policy ON governance.idempotency_records
  TO PUBLIC
  USING (
    (tenant_id IS NOT NULL AND tenant_id = governance.current_setting_uuid('app.tenant_id')) OR
    (tenant_id IS NULL AND actor_id = governance.current_setting_uuid('app.user_id'))
  )
  WITH CHECK (
    (tenant_id IS NOT NULL AND tenant_id = governance.current_setting_uuid('app.tenant_id')) OR
    (tenant_id IS NULL AND actor_id = governance.current_setting_uuid('app.user_id'))
  );

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resq_application') THEN
    GRANT USAGE ON SCHEMA governance TO resq_application;
    GRANT EXECUTE ON FUNCTION governance.current_setting_uuid(text) TO resq_application;
    GRANT SELECT, INSERT ON governance.audit_events TO resq_application;
    GRANT SELECT, INSERT, UPDATE ON governance.idempotency_records TO resq_application;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resq_worker') THEN
    GRANT USAGE ON SCHEMA governance TO resq_worker;
    GRANT EXECUTE ON FUNCTION governance.current_setting_uuid(text) TO resq_worker;
    GRANT SELECT, INSERT ON governance.audit_events TO resq_worker;
    GRANT SELECT, INSERT, UPDATE ON governance.idempotency_records TO resq_worker;
  END IF;
END;
$roles$;
`;

export class CreateGovernanceControl1793664000000 implements MigrationInterface {
  readonly name = 'CreateGovernanceControl1793664000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(GOVERNANCE_CONTROL_SQL);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Production migrations are forward-only; use a reviewed compensating migration'),
    );
  }
}
