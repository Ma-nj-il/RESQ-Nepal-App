import type { MigrationInterface, QueryRunner } from 'typeorm';

export const PRODUCT_SERVICES_SQL = String.raw`
CREATE SCHEMA product;
REVOKE ALL ON SCHEMA product FROM PUBLIC;

CREATE FUNCTION product.is_self() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $fn$
  SELECT governance.current_setting_uuid('app.user_id') IS NOT NULL
    AND governance.current_setting_uuid('app.tenant_id') IS NULL
    AND governance.current_setting_uuid('app.authority_grant_id') IS NULL
    AND EXISTS(SELECT 1 FROM identity.users WHERE id=governance.current_setting_uuid('app.user_id') AND status='ACTIVE');
$fn$;

CREATE FUNCTION product.tenant_allows(permission text, selected_tenant uuid, selected_facility uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT governance.current_setting_uuid('app.authority_grant_id') IS NULL
    AND governance.facility_is_in_scope(selected_tenant, selected_facility) AND EXISTS (
    SELECT 1 FROM access_control.resolve_tenant_context(
      governance.current_setting_uuid('app.user_id'), selected_tenant, statement_timestamp()
    ) resolved WHERE permission = ANY(resolved.permission_codes)
      AND (resolved.scope_type = 'TENANT' OR selected_facility = ANY(resolved.facility_ids))
  );
$fn$;

CREATE TABLE product.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES identity.users(id),
  booking_updates boolean NOT NULL DEFAULT true,
  trip_updates boolean NOT NULL DEFAULT true,
  support_updates boolean NOT NULL DEFAULT true,
  marketing boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE TABLE product.trip_ratings (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL UNIQUE,
  requester_user_id uuid NOT NULL REFERENCES identity.users(id),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (tenant_id, facility_id, trip_id) REFERENCES dispatch.trips(tenant_id, facility_id, id)
);
CREATE TRIGGER ratings_append_only BEFORE UPDATE OR DELETE ON product.trip_ratings
  FOR EACH ROW EXECUTE FUNCTION governance.reject_row_mutation();

CREATE TABLE product.cash_collections (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL UNIQUE,
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  recorded_by uuid NOT NULL REFERENCES identity.users(id),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL CHECK (currency = 'NPR'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (tenant_id, facility_id, trip_id) REFERENCES dispatch.trips(tenant_id, facility_id, id)
);
CREATE TRIGGER cash_append_only BEFORE UPDATE OR DELETE ON product.cash_collections
  FOR EACH ROW EXECUTE FUNCTION governance.reject_row_mutation();

CREATE TABLE product.support_tickets (
  id uuid PRIMARY KEY,
  requester_user_id uuid NOT NULL REFERENCES identity.users(id),
  trip_id uuid,
  tenant_id uuid,
  facility_id uuid,
  category varchar(32) NOT NULL CHECK (category IN ('SERVICE','BILLING','ACCOUNT','OTHER')),
  status varchar(24) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED')),
  resolution_code varchar(64),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (tenant_id, facility_id, trip_id) REFERENCES dispatch.trips(tenant_id, facility_id, id),
  CHECK ((trip_id IS NULL AND tenant_id IS NULL AND facility_id IS NULL) OR
    (trip_id IS NOT NULL AND tenant_id IS NOT NULL AND facility_id IS NOT NULL)),
  CHECK ((status = 'RESOLVED') = (resolution_code IS NOT NULL)),
  CHECK (updated_at >= created_at)
);
CREATE INDEX support_tickets_requester_idx ON product.support_tickets(requester_user_id, id);
CREATE INDEX support_tickets_scope_idx ON product.support_tickets(tenant_id, facility_id, status, id);

CREATE TABLE product.support_messages (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES product.support_tickets(id),
  author_user_id uuid NOT NULL REFERENCES identity.users(id),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 1 AND 32768),
  nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
  tag bytea NOT NULL CHECK (octet_length(tag) = 16),
  key_version varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE INDEX support_messages_ticket_idx ON product.support_messages(ticket_id, id);
CREATE TRIGGER support_messages_append_only BEFORE UPDATE OR DELETE ON product.support_messages
  FOR EACH ROW EXECUTE FUNCTION governance.reject_row_mutation();

-- An inbox item confirms a durable in-app fact, never SMS/push/email delivery.
CREATE TABLE product.notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id),
  kind varchar(40) NOT NULL CHECK (kind IN ('SUPPORT_UPDATED','CASH_RECORDED')),
  resource_id uuid NOT NULL,
  resource_version integer NOT NULL CHECK (resource_version > 0),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT notification_fact_unique UNIQUE (user_id, kind, resource_id, resource_version)
);
CREATE INDEX notifications_owner_idx ON product.notifications(user_id, id);

CREATE FUNCTION product.ticket_allows(selected_id uuid, required_permission text, content boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM product.support_tickets ticket WHERE ticket.id = selected_id AND (
      (product.is_self() AND ticket.requester_user_id = governance.current_setting_uuid('app.user_id')) OR
      (ticket.tenant_id IS NOT NULL AND product.tenant_allows(required_permission, ticket.tenant_id, ticket.facility_id)) OR
      (EXISTS (
        SELECT 1 FROM access_control.resolve_authority_context(
          governance.current_setting_uuid('app.user_id'), governance.current_setting_uuid('app.authority_grant_id'),
          statement_timestamp()
        ) grant_scope WHERE required_permission = ANY(grant_scope.permission_codes)
          AND (NOT content OR grant_scope.allows_pii)
      ) AND (
        (ticket.trip_id IS NOT NULL AND access_control.authority_allows_facility(
          required_permission::varchar,'support_ticket',ticket.tenant_id,ticket.facility_id,statement_timestamp()
        )) OR
        (ticket.trip_id IS NULL
          AND NOT EXISTS(SELECT 1 FROM access_control.authority_grant_provider_inclusions included
            WHERE included.grant_id=governance.current_setting_uuid('app.authority_grant_id'))
          AND NOT EXISTS(SELECT 1 FROM access_control.authority_grant_provider_exclusions excluded
            WHERE excluded.grant_id=governance.current_setting_uuid('app.authority_grant_id'))
          AND access_control.authority_allows(
          required_permission::varchar,'support_ticket',NULL,NULL,statement_timestamp()
        ))
      ))
    )
  );
$fn$;

-- Invoked only by the command functions, not granted to any runtime role.
CREATE FUNCTION product.record_fact(fact_id uuid, resource_id uuid, resource_type varchar,
  fact_type varchar, version integer, target_user uuid, notification_kind varchar DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE actor uuid := governance.current_setting_uuid('app.user_id'); selected_tenant uuid;
  selected_facility uuid; selected_event_type varchar; selected_sequence bigint;
BEGIN
  IF resource_type='support_ticket' THEN
    SELECT ticket.tenant_id,ticket.facility_id INTO selected_tenant,selected_facility
      FROM product.support_tickets ticket WHERE ticket.id=record_fact.resource_id;
  ELSIF resource_type IN ('trip_rating','cash_collection') THEN
    SELECT trip.tenant_id,trip.facility_id INTO selected_tenant,selected_facility
      FROM dispatch.trips trip WHERE trip.id=record_fact.resource_id;
  END IF;
  INSERT INTO governance.audit_events(id,occurred_at,actor_type,actor_id,action,resource_type,resource_id,
    outcome,reason_code,correlation_id,source_channel,retention_class,safe_context,event_hash,
    tenant_id,session_id,authority_grant_id)
  VALUES(fact_id,statement_timestamp(),'USER',actor,fact_type,resource_type,resource_id,
    'ALLOWED',upper(replace(fact_type,'.','_')),current_setting('app.correlation_id',true),'HTTP',
    'PRODUCT_OPERATIONS',jsonb_build_object('version',version),
    sha256(convert_to(jsonb_build_object('id',fact_id,'actor',actor,'resourceId',resource_id,
      'resourceType',resource_type,'action',fact_type,'version',version)::text,'UTF8')),
    selected_tenant,governance.current_setting_uuid('app.session_id'),governance.current_setting_uuid('app.authority_grant_id'));
  selected_event_type := CASE fact_type
    WHEN 'communication.preferences.replaced' THEN 'communication.preferences.replaced.v1'
    WHEN 'support.rating.recorded' THEN 'support.rating.recorded.v1'
    WHEN 'billing.cash.recorded' THEN 'billing.cash.recorded.v1'
    WHEN 'support.ticket.created' THEN 'support.ticket.created.v1'
    WHEN 'support.ticket.replied' THEN 'support.ticket.replied.v1'
    WHEN 'support.ticket.transitioned' THEN 'support.ticket.transitioned.v1'
    ELSE NULL END;
  IF selected_event_type IS NOT NULL THEN
    INSERT INTO governance.event_stream_sequences(stream_type,stream_id,tenant_id,current_sequence,updated_at)
    VALUES('product.'||resource_type,resource_id,selected_tenant,1,statement_timestamp())
    ON CONFLICT (stream_type,stream_id) DO UPDATE
      SET current_sequence=governance.event_stream_sequences.current_sequence+1,updated_at=EXCLUDED.updated_at
    RETURNING current_sequence INTO selected_sequence;
    INSERT INTO governance.outbox_events(event_id,event_type,schema_version,producer,aggregate_type,aggregate_id,
      aggregate_version,stream_type,stream_id,stream_sequence,tenant_id,facility_id,correlation_id,causation_id,
      actor_type,actor_id,event_data,occurred_at,available_at)
    VALUES(fact_id,selected_event_type,1,'product-services',resource_type,resource_id,version,'product.'||resource_type,
      resource_id,selected_sequence,selected_tenant,selected_facility,current_setting('app.correlation_id',true),
      fact_id::text,'USER',actor,jsonb_build_object('resourceId',resource_id,'version',version),
      statement_timestamp(),statement_timestamp());
  END IF;
  IF notification_kind IS NOT NULL THEN
    INSERT INTO product.notifications(id,user_id,kind,resource_id,resource_version)
    VALUES(fact_id,target_user,notification_kind,resource_id,version)
    ON CONFLICT ON CONSTRAINT notification_fact_unique DO NOTHING;
  END IF;
END;
$fn$;

CREATE FUNCTION product.replace_preferences(expected_version integer, booking boolean, trip boolean,
  support boolean, marketing_value boolean, fact_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE subject uuid := governance.current_setting_uuid('app.user_id'); current_version integer;
BEGIN
  IF NOT product.is_self() THEN RETURN 'NOT_FOUND'; END IF;
  -- Lock an existing principal to serialize the first insert as well as updates.
  PERFORM 1 FROM identity.users WHERE id = subject AND status = 'ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  SELECT version INTO current_version FROM product.notification_preferences WHERE user_id = subject;
  IF expected_version IS DISTINCT FROM COALESCE(current_version,0) THEN RETURN 'STALE_VERSION'; END IF;
  INSERT INTO product.notification_preferences(user_id,booking_updates,trip_updates,support_updates,marketing)
  VALUES(subject,booking,trip,support,marketing_value)
  ON CONFLICT (user_id) DO UPDATE SET booking_updates=EXCLUDED.booking_updates,trip_updates=EXCLUDED.trip_updates,
    support_updates=EXCLUDED.support_updates,marketing=EXCLUDED.marketing,
    version=product.notification_preferences.version+1,updated_at=statement_timestamp();
  PERFORM product.record_fact(fact_id,subject,'notification_preferences','communication.preferences.replaced',
    COALESCE(current_version,0)+1,subject);
  RETURN 'OK';
END;
$fn$;

CREATE FUNCTION product.rate_trip(selected_id uuid, selected_trip uuid, expected_version integer, score_value smallint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE trip dispatch.trips%ROWTYPE;
BEGIN
  IF NOT product.is_self() THEN RETURN 'NOT_FOUND'; END IF;
  SELECT * INTO trip FROM dispatch.trips WHERE id=selected_trip
    AND requester_user_id=governance.current_setting_uuid('app.user_id') FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF trip.version IS DISTINCT FROM expected_version THEN RETURN 'STALE_VERSION'; END IF;
  IF trip.status <> 'COMPLETED' THEN RETURN 'INVALID_STATE'; END IF;
  IF EXISTS(SELECT 1 FROM product.trip_ratings WHERE trip_id=selected_trip) THEN RETURN 'ALREADY_RECORDED'; END IF;
  INSERT INTO product.trip_ratings(id,trip_id,requester_user_id,tenant_id,facility_id,score)
  VALUES(selected_id,trip.id,trip.requester_user_id,trip.tenant_id,trip.facility_id,score_value);
  PERFORM product.record_fact(selected_id,selected_trip,'trip_rating','support.rating.recorded',1,trip.requester_user_id);
  RETURN 'OK';
END;
$fn$;

CREATE FUNCTION product.record_cash(selected_id uuid, selected_trip uuid, expected_version integer, amount bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE trip dispatch.trips%ROWTYPE;
BEGIN
  SELECT * INTO trip FROM dispatch.trips WHERE id=selected_trip FOR UPDATE;
  IF NOT FOUND OR NOT COALESCE(product.tenant_allows('cash.record',trip.tenant_id,trip.facility_id),false)
    THEN RETURN 'NOT_FOUND'; END IF;
  IF trip.version IS DISTINCT FROM expected_version THEN RETURN 'STALE_VERSION'; END IF;
  IF trip.status <> 'COMPLETED' THEN RETURN 'INVALID_STATE'; END IF;
  IF amount IS NULL OR amount < 0 OR trip.final_fare_minor IS NULL
    OR amount IS DISTINCT FROM trip.final_fare_minor OR trip.final_fare_currency IS DISTINCT FROM 'NPR'
    THEN RETURN 'AMOUNT_MISMATCH'; END IF;
  IF EXISTS(SELECT 1 FROM product.cash_collections WHERE trip_id=selected_trip) THEN RETURN 'ALREADY_RECORDED'; END IF;
  INSERT INTO product.cash_collections(id,trip_id,tenant_id,facility_id,recorded_by,amount_minor,currency)
  VALUES(selected_id,trip.id,trip.tenant_id,trip.facility_id,governance.current_setting_uuid('app.user_id'),amount,'NPR');
  PERFORM product.record_fact(selected_id,selected_trip,'cash_collection','billing.cash.recorded',1,
    trip.requester_user_id,'CASH_RECORDED');
  RETURN 'OK';
END;
$fn$;

CREATE FUNCTION product.create_ticket(selected_id uuid, selected_trip uuid, category_value varchar,
  message_id uuid, encrypted bytea, nonce_value bytea, tag_value bytea, key_id varchar)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE trip dispatch.trips%ROWTYPE; subject uuid := governance.current_setting_uuid('app.user_id');
BEGIN
  IF NOT product.is_self() THEN RETURN 'NOT_FOUND'; END IF;
  IF selected_trip IS NOT NULL THEN
    SELECT * INTO trip FROM dispatch.trips WHERE id=selected_trip AND requester_user_id=subject FOR SHARE;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  END IF;
  INSERT INTO product.support_tickets(id,requester_user_id,trip_id,tenant_id,facility_id,category)
  VALUES(selected_id,subject,selected_trip,trip.tenant_id,trip.facility_id,category_value);
  INSERT INTO product.support_messages(id,ticket_id,author_user_id,ciphertext,nonce,tag,key_version)
  VALUES(message_id,selected_id,subject,encrypted,nonce_value,tag_value,key_id);
  PERFORM product.record_fact(message_id,selected_id,'support_ticket','support.ticket.created',1,subject);
  RETURN 'OK';
END;
$fn$;

CREATE FUNCTION product.reply_ticket(selected_id uuid, expected_version integer, message_id uuid,
  encrypted bytea, nonce_value bytea, tag_value bytea, key_id varchar)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE ticket product.support_tickets%ROWTYPE;
BEGIN
  IF NOT product.ticket_allows(selected_id,'support.ticket.manage',true) THEN RETURN 'NOT_FOUND'; END IF;
  SELECT * INTO ticket FROM product.support_tickets WHERE id=selected_id FOR UPDATE;
  IF ticket.version IS DISTINCT FROM expected_version THEN RETURN 'STALE_VERSION'; END IF;
  IF ticket.status='RESOLVED' THEN RETURN 'INVALID_STATE'; END IF;
  INSERT INTO product.support_messages(id,ticket_id,author_user_id,ciphertext,nonce,tag,key_version)
  VALUES(message_id,selected_id,governance.current_setting_uuid('app.user_id'),encrypted,nonce_value,tag_value,key_id);
  UPDATE product.support_tickets SET version=version+1,updated_at=statement_timestamp() WHERE id=selected_id;
  PERFORM product.record_fact(message_id,selected_id,'support_ticket','support.ticket.replied',ticket.version+1,
    ticket.requester_user_id,CASE WHEN ticket.requester_user_id <> governance.current_setting_uuid('app.user_id')
      THEN 'SUPPORT_UPDATED' ELSE NULL END);
  RETURN 'OK';
END;
$fn$;

CREATE FUNCTION product.transition_ticket(selected_id uuid, expected_version integer, action varchar,
  resolution varchar, fact_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE ticket product.support_tickets%ROWTYPE;
BEGIN
  IF product.is_self() OR NOT product.ticket_allows(selected_id,'support.ticket.manage') THEN RETURN 'NOT_FOUND'; END IF;
  SELECT * INTO ticket FROM product.support_tickets WHERE id=selected_id FOR UPDATE;
  IF ticket.version IS DISTINCT FROM expected_version THEN RETURN 'STALE_VERSION'; END IF;
  IF ticket.status='RESOLVED' OR action NOT IN ('START','RESOLVE') OR action IS NULL
    OR (action='START' AND ticket.status<>'OPEN') THEN RETURN 'INVALID_STATE'; END IF;
  IF action='RESOLVE' AND (resolution IS NULL OR resolution !~ '^[A-Z][A-Z0-9_]{2,63}$') THEN RETURN 'INVALID_INPUT'; END IF;
  UPDATE product.support_tickets SET status=CASE WHEN action='START' THEN 'IN_PROGRESS' ELSE 'RESOLVED' END,
    resolution_code=CASE WHEN action='RESOLVE' THEN resolution ELSE NULL END,
    version=version+1,updated_at=statement_timestamp() WHERE id=selected_id;
  PERFORM product.record_fact(fact_id,selected_id,'support_ticket','support.ticket.transitioned',ticket.version+1,
    ticket.requester_user_id,'SUPPORT_UPDATED');
  RETURN 'OK';
END;
$fn$;

CREATE FUNCTION product.audit_ticket_content(selected_id uuid, fact_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE ticket_version integer;
BEGIN
  IF NOT product.ticket_allows(selected_id,'support.ticket.read',true) THEN RETURN false; END IF;
  SELECT version INTO ticket_version FROM product.support_tickets WHERE id=selected_id;
  PERFORM product.record_fact(fact_id,selected_id,'support_ticket','support.content.read',ticket_version,NULL);
  RETURN true;
END;
$fn$;

CREATE FUNCTION product.mark_notification_read(selected_id uuid, fact_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE notification product.notifications%ROWTYPE;
BEGIN
  IF NOT product.is_self() THEN RETURN false; END IF;
  SELECT * INTO notification FROM product.notifications
    WHERE id=selected_id AND user_id=governance.current_setting_uuid('app.user_id') FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF notification.read_at IS NULL THEN
    UPDATE product.notifications SET read_at=statement_timestamp() WHERE id=selected_id;
    PERFORM product.record_fact(fact_id,selected_id,'notification','communication.notification.read',1,notification.user_id);
  END IF;
  RETURN true;
END;
$fn$;

-- UTC completion cohorts; aggregates do not disclose requester or support content.
CREATE FUNCTION product.cash_summary(from_time timestamptz, to_time timestamptz)
RETURNS TABLE(facility_id uuid, completed_trips bigint, recorded_trips bigint,
  fare_minor numeric, recorded_minor numeric, unrecorded_minor numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
  IF from_time IS NULL OR to_time IS NULL OR NOT isfinite(from_time) OR NOT isfinite(to_time)
    OR to_time <= from_time OR to_time-from_time > interval '31 days' THEN
    RAISE EXCEPTION 'report window must be positive and no longer than 31 days' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT trip.facility_id,count(*),count(cash.id),sum(trip.final_fare_minor),
    COALESCE(sum(cash.amount_minor),0::numeric),
    COALESCE(sum(trip.final_fare_minor) FILTER (WHERE cash.id IS NULL),0::numeric)
  FROM dispatch.trips trip LEFT JOIN product.cash_collections cash ON cash.trip_id=trip.id
  WHERE trip.status='COMPLETED' AND trip.final_fare_currency='NPR'
    AND trip.completed_at >= from_time AND trip.completed_at < to_time
    AND product.tenant_allows('report.tenant.read',trip.tenant_id,trip.facility_id)
  GROUP BY trip.facility_id ORDER BY trip.facility_id;
END;
$fn$;

ALTER TABLE product.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE product.notification_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY preferences_self ON product.notification_preferences FOR SELECT USING
  (product.is_self() AND user_id=governance.current_setting_uuid('app.user_id'));
ALTER TABLE product.trip_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE product.trip_ratings FORCE ROW LEVEL SECURITY;
CREATE POLICY ratings_self ON product.trip_ratings FOR SELECT USING
  (product.is_self() AND requester_user_id=governance.current_setting_uuid('app.user_id'));
ALTER TABLE product.cash_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE product.cash_collections FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_scope ON product.cash_collections FOR SELECT USING (
  product.tenant_allows('cash.record',tenant_id,facility_id) OR
  (product.is_self() AND EXISTS(SELECT 1 FROM dispatch.trips trip WHERE trip.id=cash_collections.trip_id
    AND trip.requester_user_id=governance.current_setting_uuid('app.user_id')))
);
ALTER TABLE product.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE product.support_tickets FORCE ROW LEVEL SECURITY;
CREATE POLICY ticket_scope ON product.support_tickets FOR SELECT USING (product.ticket_allows(id,'support.ticket.read'));
ALTER TABLE product.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE product.support_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY message_scope ON product.support_messages FOR SELECT USING (product.ticket_allows(ticket_id,'support.ticket.read',true));
ALTER TABLE product.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE product.notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_self ON product.notifications FOR SELECT USING
  (product.is_self() AND user_id=governance.current_setting_uuid('app.user_id'));

REVOKE ALL ON ALL TABLES IN SCHEMA product FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA product FROM PUBLIC;
DO $roles$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='resq_application') THEN
    GRANT USAGE ON SCHEMA product TO resq_application;
    GRANT SELECT ON ALL TABLES IN SCHEMA product TO resq_application;
    GRANT EXECUTE ON FUNCTION product.is_self(),product.tenant_allows(text,uuid,uuid),
      product.ticket_allows(uuid,text,boolean),product.replace_preferences(integer,boolean,boolean,boolean,boolean,uuid),
      product.rate_trip(uuid,uuid,integer,smallint),product.record_cash(uuid,uuid,integer,bigint),
      product.create_ticket(uuid,uuid,varchar,uuid,bytea,bytea,bytea,varchar),
      product.reply_ticket(uuid,integer,uuid,bytea,bytea,bytea,varchar),
      product.transition_ticket(uuid,integer,varchar,varchar,uuid),product.mark_notification_read(uuid,uuid),
      product.audit_ticket_content(uuid,uuid),product.cash_summary(timestamptz,timestamptz)
      TO resq_application;
  END IF;
END;
$roles$;

-- Product events can only be minted by the command functions. Restrictive policies
-- also apply alongside earlier generic tenant/null-tenant outbox policies.
DO $event_roles$
DECLARE runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['resq_application','resq_worker'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
      EXECUTE format($policy$CREATE POLICY %I ON governance.outbox_events
        AS RESTRICTIVE FOR ALL TO %I USING (
          producer <> 'product-services' AND stream_type NOT LIKE 'product.%%'
          AND event_type NOT IN ('communication.preferences.replaced.v1','support.rating.recorded.v1',
            'billing.cash.recorded.v1','support.ticket.created.v1','support.ticket.replied.v1','support.ticket.transitioned.v1')
        )$policy$,runtime_role||'_product_events_command_only',runtime_role);
      EXECUTE format($policy$CREATE POLICY %I ON governance.event_stream_sequences
        AS RESTRICTIVE FOR ALL TO %I USING (stream_type NOT LIKE 'product.%%')$policy$,
        runtime_role||'_product_streams_command_only',runtime_role);
    END IF;
  END LOOP;
END;
$event_roles$;
`;

export class CreateProductServices1793664000005 implements MigrationInterface {
  readonly name = 'CreateProductServices1793664000005';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(PRODUCT_SERVICES_SQL);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Forward-only migration; use a reviewed compensating migration.'),
    );
  }
}
