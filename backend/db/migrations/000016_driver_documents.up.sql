-- Driver Document Verification Pipeline Migration
-- Comprehensive document management for driver onboarding

-- ========================================
-- DOCUMENT TYPES REFERENCE
-- ========================================

CREATE TABLE IF NOT EXISTS document_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE, -- 'drivers_license', 'vehicle_registration', 'insurance', 'background_check', etc.
    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Requirements
    is_required BOOLEAN DEFAULT TRUE,
    requires_expiry BOOLEAN DEFAULT TRUE,
    requires_front_back BOOLEAN DEFAULT FALSE, -- Some docs need front and back images

    -- Validity
    default_validity_months INT DEFAULT 12, -- How long the document is valid
    renewal_reminder_days INT DEFAULT 30, -- Days before expiry to send reminder

    -- Verification
    requires_manual_review BOOLEAN DEFAULT TRUE,
    auto_ocr_enabled BOOLEAN DEFAULT FALSE,

    -- Regional settings
    country_codes TEXT[], -- Array of country codes where this doc is required, NULL = all

    -- Ordering
    display_order INT DEFAULT 0,

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed common document types
INSERT INTO document_types (code, name, description, is_required, requires_expiry, requires_front_back, default_validity_months, auto_ocr_enabled, display_order) VALUES
    ('drivers_license', 'Driver''s License', 'Valid government-issued driver''s license', true, true, true, 48, true, 1),
    ('vehicle_registration', 'Vehicle Registration', 'Current vehicle registration certificate', true, true, false, 12, true, 2),
    ('vehicle_insurance', 'Vehicle Insurance', 'Valid vehicle insurance policy', true, true, false, 12, true, 3),
    ('profile_photo', 'Profile Photo', 'Recent clear photo of the driver', true, false, false, 0, false, 4),
    ('vehicle_photo', 'Vehicle Photos', 'Photos of the vehicle (exterior and interior)', true, false, false, 0, false, 5),
    ('background_check', 'Background Check', 'Criminal background check clearance', true, true, false, 24, false, 6),
    ('medical_certificate', 'Medical Certificate', 'Medical fitness certificate for driving', false, true, false, 12, false, 7),
    ('taxi_permit', 'Taxi/Rideshare Permit', 'Commercial driving permit if required', false, true, false, 12, true, 8)
ON CONFLICT (code) DO NOTHING;

-- ========================================
-- DRIVER DOCUMENTS
-- ========================================

CREATE TABLE IF NOT EXISTS driver_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    document_type_id UUID NOT NULL REFERENCES document_types(id),

    -- Document status
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'under_review', 'approved', 'rejected', 'expired', 'superseded'

    -- File storage
    file_url TEXT NOT NULL, -- S3/GCS URL
    file_key TEXT NOT NULL, -- Storage key for deletion
    file_name VARCHAR(255) NOT NULL,
    file_size_bytes BIGINT,
    file_mime_type VARCHAR(100),

    -- For documents that need front and back
    back_file_url TEXT,
    back_file_key TEXT,

    -- Document details (from OCR or manual entry)
    document_number VARCHAR(100), -- License number, plate number, etc.
    issue_date DATE,
    expiry_date DATE,
    issuing_authority VARCHAR(255),

    -- OCR extracted data (stored as JSON for flexibility)
    ocr_data JSONB,
    ocr_confidence DECIMAL(5, 4), -- 0.0000 to 1.0000
    ocr_processed_at TIMESTAMPTZ,

    -- Verification
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    rejection_reason VARCHAR(255),

    -- Versioning (when document is resubmitted)
    version INT DEFAULT 1,
    previous_document_id UUID REFERENCES driver_documents(id),

    -- Timestamps
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_driver_documents_driver ON driver_documents(driver_id);
CREATE INDEX idx_driver_documents_type ON driver_documents(document_type_id);
CREATE INDEX idx_driver_documents_status ON driver_documents(status);
CREATE INDEX idx_driver_documents_expiry ON driver_documents(expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX idx_driver_documents_pending ON driver_documents(status, submitted_at) WHERE status IN ('pending', 'under_review');
CREATE INDEX idx_driver_documents_active ON driver_documents(driver_id, document_type_id, status) WHERE status = 'approved';

-- ========================================
-- DRIVER VERIFICATION STATUS
-- ========================================

CREATE TABLE IF NOT EXISTS driver_verification_status (
    driver_id UUID PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,

    -- Overall status
    verification_status VARCHAR(50) NOT NULL DEFAULT 'incomplete', -- 'incomplete', 'pending_review', 'approved', 'suspended', 'rejected'

    -- Document completion tracking
    required_documents_count INT DEFAULT 0,
    submitted_documents_count INT DEFAULT 0,
    approved_documents_count INT DEFAULT 0,

    -- Verification milestones
    documents_submitted_at TIMESTAMPTZ, -- All required docs submitted
    documents_approved_at TIMESTAMPTZ, -- All docs approved
    background_check_completed_at TIMESTAMPTZ,

    -- Final approval
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,

    -- Suspension
    suspended_at TIMESTAMPTZ,
    suspended_by UUID REFERENCES users(id),
    suspension_reason TEXT,
    suspension_end_date DATE,

    -- Expiry tracking
    next_document_expiry DATE,
    expiry_warning_sent_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ========================================
-- DOCUMENT VERIFICATION HISTORY
-- ========================================

CREATE TABLE IF NOT EXISTS document_verification_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES driver_documents(id) ON DELETE CASCADE,

    -- Action
    action VARCHAR(50) NOT NULL, -- 'submitted', 'ocr_processed', 'review_started', 'approved', 'rejected', 'expired', 'renewed'
    previous_status VARCHAR(50),
    new_status VARCHAR(50),

    -- Actor
    performed_by UUID REFERENCES users(id), -- NULL for system actions
    is_system_action BOOLEAN DEFAULT FALSE,

    -- Details
    notes TEXT,
    metadata JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_doc_verification_history_doc ON document_verification_history(document_id, created_at DESC);

-- ========================================
-- DOCUMENT EXPIRY NOTIFICATIONS
-- ========================================

CREATE TABLE IF NOT EXISTS document_expiry_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES driver_documents(id) ON DELETE CASCADE,

    -- Notification details
    notification_type VARCHAR(50) NOT NULL, -- 'reminder_30_days', 'reminder_7_days', 'expired', 'urgent'
    days_until_expiry INT,

    -- Delivery
    sent_via VARCHAR(20)[], -- Array: ['sms', 'email', 'push']
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Response
    acknowledged_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_doc_expiry_notif_driver ON document_expiry_notifications(driver_id, created_at DESC);

-- ========================================
-- OCR PROCESSING QUEUE
-- ========================================

CREATE TABLE IF NOT EXISTS ocr_processing_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES driver_documents(id) ON DELETE CASCADE,

    -- Processing status
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    priority INT DEFAULT 0, -- Higher = more urgent

    -- OCR provider
    provider VARCHAR(50), -- 'google_vision', 'aws_textract', 'azure_cv', etc.

    -- Processing details
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    processing_time_ms INT,

    -- Results
    raw_response JSONB,
    extracted_data JSONB,
    confidence_score DECIMAL(5, 4),

    -- Errors
    error_message TEXT,
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    next_retry_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ocr_queue_pending ON ocr_processing_queue(status, priority DESC, created_at) WHERE status = 'pending';
CREATE INDEX idx_ocr_queue_retry ON ocr_processing_queue(next_retry_at) WHERE status = 'failed' AND retry_count < max_retries;

-- ========================================
-- FUNCTIONS
-- ========================================

-- Function to update driver verification status based on documents
CREATE OR REPLACE FUNCTION update_driver_verification_status()
RETURNS TRIGGER AS $$
DECLARE
    v_driver_id UUID;
    v_required_count INT;
    v_submitted_count INT;
    v_approved_count INT;
    v_new_status VARCHAR(50);
    v_next_expiry DATE;
BEGIN
    -- Get driver_id from the modified document
    v_driver_id := COALESCE(NEW.driver_id, OLD.driver_id);

    -- Count required documents
    SELECT COUNT(*) INTO v_required_count
    FROM document_types
    WHERE is_required = true AND is_active = true;

    -- Count submitted documents (latest version, not superseded)
    SELECT COUNT(DISTINCT document_type_id) INTO v_submitted_count
    FROM driver_documents
    WHERE driver_id = v_driver_id
      AND status NOT IN ('superseded', 'expired');

    -- Count approved documents
    SELECT COUNT(DISTINCT document_type_id) INTO v_approved_count
    FROM driver_documents
    WHERE driver_id = v_driver_id
      AND status = 'approved';

    -- Get next expiry date
    SELECT MIN(expiry_date) INTO v_next_expiry
    FROM driver_documents
    WHERE driver_id = v_driver_id
      AND status = 'approved'
      AND expiry_date IS NOT NULL;

    -- Determine verification status
    IF v_approved_count >= v_required_count THEN
        v_new_status := 'approved';
    ELSIF v_submitted_count >= v_required_count THEN
        v_new_status := 'pending_review';
    ELSE
        v_new_status := 'incomplete';
    END IF;

    -- Upsert verification status
    INSERT INTO driver_verification_status (
        driver_id, verification_status, required_documents_count,
        submitted_documents_count, approved_documents_count, next_document_expiry
    )
    VALUES (
        v_driver_id, v_new_status, v_required_count,
        v_submitted_count, v_approved_count, v_next_expiry
    )
    ON CONFLICT (driver_id) DO UPDATE SET
        verification_status = EXCLUDED.verification_status,
        required_documents_count = EXCLUDED.required_documents_count,
        submitted_documents_count = EXCLUDED.submitted_documents_count,
        approved_documents_count = EXCLUDED.approved_documents_count,
        next_document_expiry = EXCLUDED.next_document_expiry,
        documents_submitted_at = CASE
            WHEN EXCLUDED.submitted_documents_count >= EXCLUDED.required_documents_count
                 AND driver_verification_status.documents_submitted_at IS NULL
            THEN NOW()
            ELSE driver_verification_status.documents_submitted_at
        END,
        documents_approved_at = CASE
            WHEN EXCLUDED.approved_documents_count >= EXCLUDED.required_documents_count
                 AND driver_verification_status.documents_approved_at IS NULL
            THEN NOW()
            ELSE driver_verification_status.documents_approved_at
        END,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update verification status on document changes
CREATE TRIGGER trigger_update_driver_verification
    AFTER INSERT OR UPDATE OF status ON driver_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_driver_verification_status();

-- Function to expire documents
CREATE OR REPLACE FUNCTION expire_outdated_documents() RETURNS INT AS $$
DECLARE
    v_expired_count INT;
BEGIN
    WITH expired_docs AS (
        UPDATE driver_documents
        SET status = 'expired', updated_at = NOW()
        WHERE status = 'approved'
          AND expiry_date IS NOT NULL
          AND expiry_date < CURRENT_DATE
        RETURNING id, driver_id
    )
    SELECT COUNT(*) INTO v_expired_count FROM expired_docs;

    -- Log history for expired documents
    INSERT INTO document_verification_history (document_id, action, previous_status, new_status, is_system_action, notes)
    SELECT id, 'expired', 'approved', 'expired', true, 'Document automatically expired'
    FROM driver_documents
    WHERE status = 'expired'
      AND expiry_date = CURRENT_DATE - INTERVAL '1 day';

    RETURN v_expired_count;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- TRIGGERS FOR TIMESTAMPS
-- ========================================

CREATE TRIGGER trigger_document_types_updated
    BEFORE UPDATE ON document_types
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_driver_documents_updated
    BEFORE UPDATE ON driver_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_verification_status_updated
    BEFORE UPDATE ON driver_verification_status
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_ocr_queue_updated
    BEFORE UPDATE ON ocr_processing_queue
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- VIEWS
-- ========================================

-- View for pending document reviews
CREATE OR REPLACE VIEW v_pending_document_reviews AS
SELECT
    dd.id AS document_id,
    dd.driver_id,
    u.first_name || ' ' || u.last_name AS driver_name,
    u.phone_number AS driver_phone,
    dt.code AS document_type_code,
    dt.name AS document_type_name,
    dd.status,
    dd.file_url,
    dd.document_number,
    dd.expiry_date,
    dd.ocr_confidence,
    dd.submitted_at,
    EXTRACT(EPOCH FROM (NOW() - dd.submitted_at)) / 3600 AS hours_pending
FROM driver_documents dd
JOIN drivers d ON dd.driver_id = d.id
JOIN users u ON d.user_id = u.id
JOIN document_types dt ON dd.document_type_id = dt.id
WHERE dd.status IN ('pending', 'under_review')
ORDER BY dd.submitted_at ASC;

-- View for expiring documents
CREATE OR REPLACE VIEW v_expiring_documents AS
SELECT
    dd.id AS document_id,
    dd.driver_id,
    u.first_name || ' ' || u.last_name AS driver_name,
    u.email AS driver_email,
    u.phone_number AS driver_phone,
    dt.code AS document_type_code,
    dt.name AS document_type_name,
    dd.expiry_date,
    (dd.expiry_date - CURRENT_DATE) AS days_until_expiry,
    CASE
        WHEN dd.expiry_date < CURRENT_DATE THEN 'expired'
        WHEN dd.expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'critical'
        WHEN dd.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'warning'
        ELSE 'ok'
    END AS urgency
FROM driver_documents dd
JOIN drivers d ON dd.driver_id = d.id
JOIN users u ON d.user_id = u.id
JOIN document_types dt ON dd.document_type_id = dt.id
WHERE dd.status = 'approved'
  AND dd.expiry_date IS NOT NULL
  AND dd.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
ORDER BY dd.expiry_date ASC;

-- ========================================
-- COMMENTS
-- ========================================

COMMENT ON TABLE document_types IS 'Reference table for document types required for driver verification';
COMMENT ON TABLE driver_documents IS 'Stores uploaded documents for driver verification';
COMMENT ON TABLE driver_verification_status IS 'Tracks overall verification status for each driver';
COMMENT ON TABLE document_verification_history IS 'Audit trail for document status changes';
COMMENT ON TABLE document_expiry_notifications IS 'Tracks notifications sent for expiring documents';
COMMENT ON TABLE ocr_processing_queue IS 'Queue for OCR processing of uploaded documents';

COMMENT ON VIEW v_pending_document_reviews IS 'Documents awaiting admin review';
COMMENT ON VIEW v_expiring_documents IS 'Documents expiring within 30 days';
