-- Rollback Driver Document Verification Pipeline Migration

-- Drop views
DROP VIEW IF EXISTS v_expiring_documents;
DROP VIEW IF EXISTS v_pending_document_reviews;

-- Drop triggers
DROP TRIGGER IF EXISTS trigger_ocr_queue_updated ON ocr_processing_queue;
DROP TRIGGER IF EXISTS trigger_verification_status_updated ON driver_verification_status;
DROP TRIGGER IF EXISTS trigger_driver_documents_updated ON driver_documents;
DROP TRIGGER IF EXISTS trigger_document_types_updated ON document_types;
DROP TRIGGER IF EXISTS trigger_update_driver_verification ON driver_documents;

-- Drop functions
DROP FUNCTION IF EXISTS expire_outdated_documents();
DROP FUNCTION IF EXISTS update_driver_verification_status();

-- Drop tables
DROP TABLE IF EXISTS ocr_processing_queue;
DROP TABLE IF EXISTS document_expiry_notifications;
DROP TABLE IF EXISTS document_verification_history;
DROP TABLE IF EXISTS driver_verification_status;
DROP TABLE IF EXISTS driver_documents;
DROP TABLE IF EXISTS document_types;
