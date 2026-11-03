import type { MigrationInterface, QueryRunner } from 'typeorm';

export const GOVERNANCE_DELIVERY_SQL = String.raw`
CREATE TABLE governance.event_stream_sequences (
  stream_type varchar(96) NOT NULL,
  stream_id uuid NOT NULL,
  tenant_id uuid,
  current_sequence bigint NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (stream_type, stream_id),
  CONSTRAINT event_stream_sequence_positive CHECK (current_sequence >= 0)
);

ALTER TABLE governance.event_stream_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.event_stream_sequences FORCE ROW LEVEL SECURITY;
CREATE POLICY event_stream_sequences_tenant_policy ON governance.event_stream_sequences
  TO PUBLIC
  USING (tenant_id IS NOT NULL AND tenant_id = governance.current_setting_uuid('app.tenant_id'))
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = governance.current_setting_uuid('app.tenant_id'));

CREATE TABLE governance.outbox_events (
  event_id uuid PRIMARY KEY,
  event_type varchar(200) NOT NULL,
  schema_version integer NOT NULL,
  producer varchar(96) NOT NULL,
  aggregate_type varchar(96) NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version bigint NOT NULL,
  stream_type varchar(96) NOT NULL,
  stream_id uuid NOT NULL,
  stream_sequence bigint NOT NULL,
  tenant_id uuid,
  facility_id uuid,
  correlation_id varchar(128) NOT NULL,
  causation_id varchar(128) NOT NULL,
  traceparent varchar(256),
  actor_type varchar(32) NOT NULL,
  actor_id uuid,
  event_data jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  published_at timestamptz,
  publish_attempts integer NOT NULL DEFAULT 0,
  last_error_code varchar(128),
  broker_partition integer,
  broker_offset bigint,
  UNIQUE (stream_type, stream_id, stream_sequence),
  CONSTRAINT outbox_schema_version_positive CHECK (schema_version > 0),
  CONSTRAINT outbox_aggregate_version_positive CHECK (aggregate_version > 0),
  CONSTRAINT outbox_stream_sequence_positive CHECK (stream_sequence > 0),
  CONSTRAINT outbox_publish_attempts_positive CHECK (publish_attempts >= 0),
  CONSTRAINT outbox_event_data_object CHECK (jsonb_typeof(event_data) = 'object'),
  CONSTRAINT outbox_actor_type CHECK (actor_type IN ('USER', 'WORKLOAD', 'SYSTEM_POLICY')),
  CONSTRAINT outbox_actor_shape CHECK (
    (actor_type IN ('USER', 'WORKLOAD') AND actor_id IS NOT NULL) OR
    actor_type = 'SYSTEM_POLICY'
  ),
  CONSTRAINT outbox_publish_shape CHECK (
    (published_at IS NULL AND broker_partition IS NULL AND broker_offset IS NULL) OR
    (published_at IS NOT NULL AND broker_partition IS NOT NULL AND broker_offset IS NOT NULL)
  ),
  CONSTRAINT outbox_time_order CHECK (
    available_at >= occurred_at AND (published_at IS NULL OR published_at >= occurred_at)
  )
);

CREATE INDEX outbox_events_unpublished_idx
  ON governance.outbox_events (available_at, occurred_at, event_id)
  WHERE published_at IS NULL;
CREATE INDEX outbox_events_stream_unpublished_idx
  ON governance.outbox_events (stream_type, stream_id, stream_sequence)
  WHERE published_at IS NULL;
CREATE INDEX outbox_events_tenant_time_idx
  ON governance.outbox_events (tenant_id, occurred_at DESC);

ALTER TABLE governance.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.outbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_events_tenant_policy ON governance.outbox_events
  TO PUBLIC
  USING (tenant_id IS NOT NULL AND tenant_id = governance.current_setting_uuid('app.tenant_id'))
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = governance.current_setting_uuid('app.tenant_id'));

CREATE TABLE governance.inbox_messages (
  consumer_name varchar(160) NOT NULL,
  event_id uuid NOT NULL,
  event_type varchar(200) NOT NULL,
  schema_version integer NOT NULL,
  tenant_id uuid,
  stream_type varchar(96) NOT NULL,
  stream_id uuid NOT NULL,
  stream_sequence bigint NOT NULL,
  aggregate_version bigint NOT NULL,
  state varchar(24) NOT NULL,
  received_at timestamptz NOT NULL,
  completed_at timestamptz,
  result_code varchar(128),
  error_code varchar(128),
  PRIMARY KEY (consumer_name, event_id),
  CONSTRAINT inbox_schema_version_positive CHECK (schema_version > 0),
  CONSTRAINT inbox_sequence_positive CHECK (stream_sequence > 0 AND aggregate_version > 0),
  CONSTRAINT inbox_state CHECK (state IN ('PROCESSING', 'COMPLETED', 'FAILED_RETRYABLE', 'QUARANTINED')),
  CONSTRAINT inbox_completion_shape CHECK (
    (state = 'PROCESSING' AND completed_at IS NULL AND result_code IS NULL AND error_code IS NULL) OR
    (state = 'COMPLETED' AND completed_at IS NOT NULL AND result_code IS NOT NULL AND error_code IS NULL) OR
    (state IN ('FAILED_RETRYABLE', 'QUARANTINED') AND completed_at IS NOT NULL AND error_code IS NOT NULL)
  ),
  CONSTRAINT inbox_time_order CHECK (completed_at IS NULL OR completed_at >= received_at)
);

CREATE INDEX inbox_messages_stream_idx
  ON governance.inbox_messages (consumer_name, stream_type, stream_id, stream_sequence DESC);
CREATE INDEX inbox_messages_retry_idx
  ON governance.inbox_messages (completed_at)
  WHERE state = 'FAILED_RETRYABLE';

ALTER TABLE governance.inbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.inbox_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY inbox_messages_tenant_policy ON governance.inbox_messages
  TO PUBLIC
  USING (tenant_id IS NOT NULL AND tenant_id = governance.current_setting_uuid('app.tenant_id'))
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = governance.current_setting_uuid('app.tenant_id'));

CREATE TABLE governance.job_intents (
  id uuid PRIMARY KEY,
  deterministic_job_id varchar(200) NOT NULL UNIQUE,
  job_type varchar(200) NOT NULL,
  queue_name varchar(96) NOT NULL,
  tenant_id uuid,
  resource_type varchar(96) NOT NULL,
  resource_id uuid NOT NULL,
  resource_version bigint,
  run_at timestamptz NOT NULL,
  correlation_id varchar(128) NOT NULL,
  causation_id varchar(128) NOT NULL,
  traceparent varchar(256),
  requested_by_type varchar(32) NOT NULL,
  requested_by_id varchar(160) NOT NULL,
  job_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  state varchar(24) NOT NULL,
  enqueue_attempts integer NOT NULL DEFAULT 0,
  enqueued_at timestamptz,
  queue_job_id varchar(200),
  completed_at timestamptz,
  result_code varchar(128),
  error_code varchar(128),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT job_intent_resource_version CHECK (resource_version IS NULL OR resource_version > 0),
  CONSTRAINT job_intent_data_object CHECK (jsonb_typeof(job_data) = 'object'),
  CONSTRAINT job_intent_requester_type CHECK (requested_by_type IN ('USER', 'WORKLOAD', 'SYSTEM_POLICY')),
  CONSTRAINT job_intent_state CHECK (
    state IN ('PENDING', 'ENQUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')
  ),
  CONSTRAINT job_intent_attempts_positive CHECK (enqueue_attempts >= 0),
  CONSTRAINT job_intent_enqueue_shape CHECK (
    (state = 'PENDING' AND enqueued_at IS NULL AND queue_job_id IS NULL) OR
    (state <> 'PENDING' AND enqueued_at IS NOT NULL AND queue_job_id IS NOT NULL)
  ),
  CONSTRAINT job_intent_completion_shape CHECK (
    (state IN ('PENDING', 'ENQUEUED', 'RUNNING') AND completed_at IS NULL AND result_code IS NULL AND error_code IS NULL) OR
    (state IN ('SUCCEEDED', 'CANCELLED') AND completed_at IS NOT NULL AND result_code IS NOT NULL AND error_code IS NULL) OR
    (state = 'FAILED' AND completed_at IS NOT NULL AND error_code IS NOT NULL)
  ),
  CONSTRAINT job_intent_time_order CHECK (
    updated_at >= created_at AND
    (enqueued_at IS NULL OR enqueued_at >= created_at) AND
    (completed_at IS NULL OR completed_at >= created_at)
  )
);

CREATE INDEX job_intents_pending_idx
  ON governance.job_intents (run_at, created_at, id)
  WHERE state = 'PENDING';
CREATE INDEX job_intents_tenant_resource_idx
  ON governance.job_intents (tenant_id, resource_type, resource_id, created_at DESC);
CREATE INDEX job_intents_terminal_idx
  ON governance.job_intents (completed_at)
  WHERE state IN ('SUCCEEDED', 'FAILED', 'CANCELLED');

ALTER TABLE governance.job_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.job_intents FORCE ROW LEVEL SECURITY;
CREATE POLICY job_intents_tenant_policy ON governance.job_intents
  TO PUBLIC
  USING (tenant_id IS NOT NULL AND tenant_id = governance.current_setting_uuid('app.tenant_id'))
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = governance.current_setting_uuid('app.tenant_id'));

REVOKE ALL ON governance.event_stream_sequences FROM PUBLIC;
REVOKE ALL ON governance.outbox_events FROM PUBLIC;
REVOKE ALL ON governance.inbox_messages FROM PUBLIC;
REVOKE ALL ON governance.job_intents FROM PUBLIC;

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resq_application') THEN
    GRANT SELECT, INSERT, UPDATE ON governance.event_stream_sequences TO resq_application;
    GRANT SELECT, INSERT ON governance.outbox_events TO resq_application;
    GRANT SELECT, INSERT ON governance.job_intents TO resq_application;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resq_worker') THEN
    GRANT SELECT, INSERT, UPDATE ON governance.event_stream_sequences TO resq_worker;
    GRANT SELECT, INSERT ON governance.outbox_events TO resq_worker;
    GRANT SELECT, INSERT, UPDATE ON governance.inbox_messages TO resq_worker;
    GRANT SELECT, INSERT, UPDATE ON governance.job_intents TO resq_worker;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resq_outbox_relay') THEN
    GRANT USAGE ON SCHEMA governance TO resq_outbox_relay;
    GRANT SELECT, UPDATE ON governance.outbox_events TO resq_outbox_relay;
    EXECUTE 'CREATE POLICY outbox_events_relay_policy ON governance.outbox_events FOR ALL TO resq_outbox_relay USING (true) WITH CHECK (true)';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resq_job_relay') THEN
    GRANT USAGE ON SCHEMA governance TO resq_job_relay;
    GRANT SELECT, UPDATE ON governance.job_intents TO resq_job_relay;
    EXECUTE 'CREATE POLICY job_intents_relay_policy ON governance.job_intents FOR ALL TO resq_job_relay USING (true) WITH CHECK (true)';
  END IF;
END;
$roles$;
`;

export class CreateGovernanceDelivery1793664000001 implements MigrationInterface {
  readonly name = 'CreateGovernanceDelivery1793664000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(GOVERNANCE_DELIVERY_SQL);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Production migrations are forward-only; use a reviewed compensating migration'),
    );
  }
}
