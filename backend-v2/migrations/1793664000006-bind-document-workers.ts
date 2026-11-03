import type { MigrationInterface, QueryRunner } from 'typeorm';

export const DOCUMENT_WORKERS_SQL = String.raw`
ALTER TABLE governance.job_intents ADD COLUMN execution_id uuid;

-- Prior document IDs contained BullMQ's reserved colon separator. Rebind only outstanding work.
UPDATE governance.job_intents job
   SET resource_type = 'documentObject', resource_id = document.id
  FROM documents.document_projection document
 WHERE job.job_type = 'compliance.recalculate-readiness.v1'
   AND job.state NOT IN ('SUCCEEDED','FAILED','CANCELLED')
   AND split_part(job.deterministic_job_id, ':', 2) = document.link_id::text;
UPDATE governance.job_intents
   SET deterministic_job_id = replace(deterministic_job_id, ':', '-'),
       queue_job_id = replace(queue_job_id, ':', '-')
 WHERE job_type IN ('document.scan-object.v1','document.expire.v1','compliance.recalculate-readiness.v1')
   AND state NOT IN ('SUCCEEDED','FAILED','CANCELLED') AND position(':' IN deterministic_job_id) > 0;

CREATE FUNCTION documents.worker_document_visible(selected_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT pg_has_role(COALESCE(NULLIF(current_setting('role'), 'none'), session_user), 'resq_worker', 'MEMBER')
    AND EXISTS (
      SELECT 1 FROM governance.job_intents job JOIN documents.document_objects object
        ON object.id = job.resource_id AND object.tenant_id IS NOT DISTINCT FROM job.tenant_id
       WHERE job.id = governance.current_setting_uuid('app.job_intent_id')
         AND job.execution_id = governance.current_setting_uuid('app.job_execution_id')
         AND job.state = 'RUNNING' AND job.run_at <= statement_timestamp()
         AND job.resource_type = 'documentObject' AND job.resource_id = selected_id
         AND ((job.queue_name = 'documents' AND job.job_type IN ('document.scan-object.v1','document.expire.v1'))
           OR (job.queue_name = 'compliance' AND job.job_type = 'compliance.recalculate-readiness.v1'))
    );
$fn$;

-- Lock the execution before touching its resource. A replacement claim cannot race the commit.
CREATE FUNCTION documents.lock_worker_document(selected_id uuid, selected_type text, selected_version bigint)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
  IF NOT documents.worker_document_visible(selected_id) THEN RETURN false; END IF;
  PERFORM 1 FROM governance.job_intents job
   WHERE job.id = governance.current_setting_uuid('app.job_intent_id')
     AND job.execution_id = governance.current_setting_uuid('app.job_execution_id')
     AND job.state = 'RUNNING' AND job.job_type = selected_type
     AND job.resource_id = selected_id AND job.resource_version = selected_version
   FOR SHARE;
  RETURN FOUND;
END;
$fn$;

CREATE FUNCTION documents.record_worker_scan(
  selected_id uuid, expected_version bigint, selected_outcome text, selected_mime text, selected_code text
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE
  link_table text;
  changed_id uuid;
  now_at timestamptz := statement_timestamp();
BEGIN
  IF NOT documents.lock_worker_document(selected_id, 'document.scan-object.v1', expected_version)
    THEN RETURN false; END IF;
  IF selected_outcome NOT IN ('READY','QUARANTINED','FAILED') OR selected_outcome IS NULL
    OR selected_code IS NULL OR selected_code !~ '^[A-Za-z0-9._-]{1,128}$'
    THEN RAISE EXCEPTION 'invalid scan result' USING ERRCODE = '22023'; END IF;
  UPDATE documents.document_objects
     SET upload_status = selected_outcome, detected_mime_type = COALESCE(selected_mime, detected_mime_type),
         scanner_code = selected_code, scanned_at = now_at, updated_at = now_at, version = version + 1
   WHERE id = selected_id AND version = expected_version AND upload_status = 'SCANNING'
     AND (selected_outcome <> 'READY' OR
       (selected_mime IN ('application/pdf','image/jpeg','image/png') AND selected_mime = declared_mime_type))
   RETURNING id INTO changed_id;
  IF changed_id IS NULL THEN RETURN false; END IF;
  IF selected_outcome = 'READY' THEN
    FOREACH link_table IN ARRAY ARRAY['user_identity_documents','provider_application_documents',
      'driver_application_documents','driver_documents','ambulance_documents','facility_documents'] LOOP
      EXECUTE format('UPDATE documents.%I SET review_status = ''PENDING'', version = version + 1,
        updated_at = $2 WHERE document_object_id = $1 AND review_status = ''NOT_SUBMITTED''', link_table)
        USING selected_id, now_at;
    END LOOP;
  END IF;
  RETURN true;
END;
$fn$;

CREATE FUNCTION documents.expire_worker_document(selected_id uuid, expected_version bigint)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE
  link_table text;
  changed_count integer := 0;
  affected integer;
  now_at timestamptz := statement_timestamp();
BEGIN
  IF NOT documents.lock_worker_document(selected_id, 'document.expire.v1', expected_version)
    THEN RETURN false; END IF;
  PERFORM 1 FROM documents.document_objects
   WHERE id = selected_id AND version = expected_version AND upload_status = 'READY' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  FOREACH link_table IN ARRAY ARRAY['user_identity_documents','provider_application_documents',
    'driver_application_documents','driver_documents','ambulance_documents','facility_documents'] LOOP
    EXECUTE format('UPDATE documents.%I SET review_status = ''EXPIRED'', version = version + 1,
      updated_at = $2 WHERE document_object_id = $1 AND review_status = ''APPROVED''
      AND expires_on < ($2 AT TIME ZONE ''UTC'')::date', link_table) USING selected_id, now_at;
    GET DIAGNOSTICS affected = ROW_COUNT;
    changed_count := changed_count + affected;
  END LOOP;
  IF changed_count = 0 THEN RETURN false; END IF;
  UPDATE documents.document_objects SET version = version + 1, updated_at = now_at WHERE id = selected_id;
  RETURN true;
END;
$fn$;

CREATE FUNCTION documents.refresh_worker_readiness(selected_id uuid, expected_version bigint)
RETURNS TABLE(ambulance_id uuid, tenant_id uuid, facility_id uuid, readiness_version integer,
  readiness_status varchar, readiness_reasons varchar[])
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE
  target_id uuid;
  prior_version integer;
  intent governance.job_intents%ROWTYPE;
  now_at timestamptz := statement_timestamp();
BEGIN
  IF NOT pg_has_role(COALESCE(NULLIF(current_setting('role'), 'none'), session_user), 'resq_worker', 'MEMBER')
    THEN RETURN; END IF;
  SELECT * INTO intent FROM governance.job_intents job
   WHERE job.id = governance.current_setting_uuid('app.job_intent_id')
     AND job.execution_id = governance.current_setting_uuid('app.job_execution_id')
     AND job.state = 'RUNNING' AND job.run_at <= statement_timestamp()
     AND job.job_type = 'compliance.recalculate-readiness.v1' AND job.queue_name = 'compliance'
     AND job.resource_id = selected_id AND job.resource_version = expected_version FOR SHARE;
  IF NOT FOUND THEN RETURN; END IF;
  -- Only ambulance documents feed the materialized fleet projection. Other subjects have live checks.
  IF intent.resource_type = 'documentObject' THEN
    SELECT document.ambulance_id INTO target_id FROM documents.ambulance_documents document
      JOIN documents.document_objects object ON object.id = document.document_object_id
     WHERE object.id = selected_id AND document.tenant_id = object.tenant_id AND object.tenant_id = intent.tenant_id;
  ELSIF intent.resource_type = 'ambulance' THEN
    SELECT ambulance.id INTO target_id FROM fleet.ambulances ambulance
     WHERE ambulance.id = selected_id AND ambulance.tenant_id = intent.tenant_id;
  END IF;
  IF target_id IS NULL THEN RETURN; END IF;
  SELECT ambulance.readiness_version INTO prior_version FROM fleet.ambulances ambulance
   WHERE ambulance.id = target_id FOR UPDATE;
  PERFORM fleet.refresh_ambulance_readiness(target_id, (now_at AT TIME ZONE 'UTC')::date, now_at);
  RETURN QUERY SELECT ambulance.id, ambulance.tenant_id, ambulance.facility_id,
    ambulance.readiness_version, ambulance.readiness_status, ambulance.readiness_reasons
    FROM fleet.ambulances ambulance WHERE ambulance.id = target_id AND ambulance.readiness_version <> prior_version;
END;
$fn$;

REVOKE ALL ON FUNCTION documents.worker_document_visible(uuid),
  documents.lock_worker_document(uuid,text,bigint),
  documents.record_worker_scan(uuid,bigint,text,text,text), documents.expire_worker_document(uuid,bigint),
  documents.refresh_worker_readiness(uuid,bigint) FROM PUBLIC;

DO $roles$
DECLARE link_table text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resq_worker') THEN
    REVOKE UPDATE ON documents.document_objects, documents.user_identity_documents,
      documents.provider_application_documents, documents.driver_application_documents,
      documents.driver_documents, documents.ambulance_documents, documents.facility_documents FROM resq_worker;
    REVOKE EXECUTE ON FUNCTION fleet.refresh_ambulance_readiness(uuid,date,timestamptz) FROM resq_worker;
    GRANT EXECUTE ON FUNCTION documents.worker_document_visible(uuid),
      documents.record_worker_scan(uuid,bigint,text,text,text), documents.expire_worker_document(uuid,bigint),
      documents.refresh_worker_readiness(uuid,bigint) TO resq_worker;
    CREATE POLICY document_worker_select ON documents.document_objects FOR SELECT TO resq_worker
      USING (documents.worker_document_visible(id));
    CREATE POLICY document_worker_bound ON documents.document_objects AS RESTRICTIVE FOR SELECT TO resq_worker
      USING (documents.worker_document_visible(id));
    FOREACH link_table IN ARRAY ARRAY['user_identity_documents','provider_application_documents',
      'driver_application_documents','driver_documents','ambulance_documents','facility_documents'] LOOP
      EXECUTE format('CREATE POLICY document_worker_select ON documents.%I FOR SELECT TO resq_worker
        USING (documents.worker_document_visible(document_object_id))', link_table);
      EXECUTE format('CREATE POLICY document_worker_bound ON documents.%I AS RESTRICTIVE FOR SELECT TO resq_worker
        USING (documents.worker_document_visible(document_object_id))', link_table);
    END LOOP;
  END IF;
END;
$roles$;
`;

export class BindDocumentWorkers1793664000006 implements MigrationInterface {
  readonly name = 'BindDocumentWorkers1793664000006';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(DOCUMENT_WORKERS_SQL);
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error('Production migrations are forward-only; use a reviewed compensating migration'),
    );
  }
}
