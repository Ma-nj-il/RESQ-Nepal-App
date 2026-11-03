import { Injectable } from '@nestjs/common';

import type { TransactionContext } from '../../../shared/application/persistence/unit-of-work.js';
import { entityManagerFor } from '../../../shared/infrastructure/persistence/typeorm-unit-of-work.js';
import type {
  AmbulanceRecord,
  DriverApplicationRecord,
  DriverRecord,
  FacilityRecord,
  MaintenanceRecord,
  ProviderApplicationRecord,
  ProviderOrganizationRecord,
  ProviderOperationsRepository,
} from '../../application/ports/provider-operations.repository.js';

interface ProviderApplicationRow {
  readonly id: string;
  readonly applicant_user_id: string;
  readonly legal_name: string;
  readonly display_name: string;
  readonly registration_number: string;
  readonly geographic_unit_id: string;
  readonly facility_name: string;
  readonly facility_type: string;
  readonly public_phone: string | null;
  readonly status: ProviderApplicationRecord['status'];
  readonly version: number;
  readonly submitted_at: Date | null;
  readonly decided_at: Date | null;
  readonly tenant_id: string | null;
  readonly facility_id: string | null;
}

interface DriverApplicationRow {
  readonly id: string;
  readonly applicant_user_id: string;
  readonly tenant_id: string;
  readonly facility_id: string;
  readonly licence_number: string;
  readonly licence_expires_on: string;
  readonly status: DriverApplicationRecord['status'];
  readonly version: number;
  readonly submitted_at: Date | null;
}

interface DriverRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly licence_number: string;
  readonly licence_expires_on: string;
  readonly verification_status: DriverRecord['verificationStatus'];
  readonly account_status: DriverRecord['accountStatus'];
  readonly duty_status: DriverRecord['dutyStatus'];
  readonly facility_ids: string[];
  readonly eligibility_reasons: string[];
  readonly version: number;
}

interface AmbulanceRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly facility_id: string;
  readonly plate_number: string;
  readonly vin: string | null;
  readonly category: string;
  readonly compliance_status: AmbulanceRecord['complianceStatus'];
  readonly operational_status: AmbulanceRecord['operationalStatus'];
  readonly gps_quality: AmbulanceRecord['gpsQuality'];
  readonly readiness_status: AmbulanceRecord['readinessStatus'];
  readonly effective_readiness_reasons: string[];
  readonly readiness_version: number;
  readonly version: number;
}

interface MaintenanceRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly facility_id: string;
  readonly ambulance_id: string;
  readonly maintenance_type: MaintenanceRecord['maintenanceType'];
  readonly status: MaintenanceRecord['status'];
  readonly scheduled_for: Date;
  readonly odometer_meters: string | null;
  readonly notes: string;
  readonly version: number;
}

interface ProviderOrganizationRow {
  readonly id: string;
  readonly legal_name: string;
  readonly display_name: string;
  readonly registration_number: string | null;
  readonly operating_status: ProviderOrganizationRecord['operatingStatus'];
  readonly version: number;
}

interface FacilityRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly geographic_unit_id: string;
  readonly name: string;
  readonly facility_type: string;
  readonly operating_status: FacilityRecord['operatingStatus'];
  readonly public_phone: string | null;
  readonly version: number;
}

const PROVIDER_APPLICATION_SELECT = `
  SELECT id, applicant_user_id, legal_name, display_name, registration_number,
         geographic_unit_id, facility_name, facility_type, public_phone, status,
         version, submitted_at, decided_at, tenant_id, facility_id
    FROM provider_registry.provider_applications`;

const DRIVER_APPLICATION_SELECT = `
  SELECT id, applicant_user_id, tenant_id, facility_id, licence_number,
         licence_expires_on::text, status, version, submitted_at
    FROM workforce.driver_applications`;

const DRIVER_SELECT = `
  SELECT driver.id, driver.tenant_id, driver.user_id, driver.licence_number,
         driver.licence_expires_on::text, driver.verification_status,
         driver.account_status, driver.duty_status, driver.version,
         COALESCE((
           SELECT array_agg(affiliation.facility_id ORDER BY affiliation.facility_id)
             FROM workforce.driver_facility_assignments affiliation
            WHERE affiliation.driver_id = driver.id AND affiliation.ended_at IS NULL
              AND affiliation.valid_from <= now()
              AND (affiliation.valid_until IS NULL OR affiliation.valid_until > now())
         ), ARRAY[]::uuid[]) AS facility_ids,
         array_remove(ARRAY[
           CASE WHEN driver.verification_status <> 'VERIFIED' OR driver.licence_expires_on < current_date
             THEN 'VERIFICATION_NOT_VALID' END,
           CASE WHEN driver.account_status <> 'ACTIVE' THEN 'ACCOUNT_NOT_ACTIVE' END,
           CASE WHEN driver.duty_status <> 'AVAILABLE' THEN 'NOT_AVAILABLE_FOR_DUTY' END,
           CASE WHEN NOT EXISTS (
             SELECT 1 FROM workforce.driver_facility_assignments active_affiliation
              WHERE active_affiliation.driver_id = driver.id AND active_affiliation.ended_at IS NULL
                AND active_affiliation.valid_from <= now()
                AND (active_affiliation.valid_until IS NULL OR active_affiliation.valid_until > now())
           ) THEN 'NO_ACTIVE_FACILITY_AFFILIATION' END,
           CASE WHEN NOT EXISTS (
             SELECT 1 FROM documents.driver_documents document
             JOIN documents.document_objects object ON object.id = document.document_object_id
              WHERE document.driver_id = driver.id AND object.upload_status = 'READY'
                AND document.review_status = 'APPROVED'
                AND (document.expires_on IS NULL OR document.expires_on >= current_date)
           ) THEN 'DOCUMENTS_NOT_CURRENT' END,
           CASE WHEN EXISTS (
             SELECT 1 FROM fleet.crew_ambulance_assignments crew
              WHERE crew.driver_id = driver.id AND crew.released_at IS NULL
           ) THEN 'ACTIVE_TRIP_CONFLICT' END
         ], NULL) AS eligibility_reasons
    FROM workforce.driver_profiles driver`;

const AMBULANCE_SELECT = `
  SELECT ambulance.id, ambulance.tenant_id, ambulance.facility_id, ambulance.plate_number,
         ambulance.vin, ambulance.category, ambulance.compliance_status,
         ambulance.operational_status, ambulance.gps_quality, ambulance.readiness_status,
         CASE WHEN ambulance.operational_status = 'AVAILABLE'
           THEN ambulance.readiness_reasons
           ELSE array_prepend('NOT_OPERATIONALLY_AVAILABLE'::varchar, ambulance.readiness_reasons)
         END AS effective_readiness_reasons,
         ambulance.readiness_version, ambulance.version
    FROM fleet.ambulances ambulance`;

function providerApplicationFrom(row: ProviderApplicationRow): ProviderApplicationRecord {
  return {
    id: row.id,
    applicantUserId: row.applicant_user_id,
    legalName: row.legal_name,
    displayName: row.display_name,
    registrationNumber: row.registration_number,
    geographicUnitId: row.geographic_unit_id,
    facilityName: row.facility_name,
    facilityType: row.facility_type,
    ...(row.public_phone === null ? {} : { publicPhone: row.public_phone }),
    status: row.status,
    version: row.version,
    ...(row.submitted_at === null ? {} : { submittedAt: row.submitted_at }),
    ...(row.decided_at === null ? {} : { decidedAt: row.decided_at }),
    ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
    ...(row.facility_id === null ? {} : { facilityId: row.facility_id }),
  };
}

function driverApplicationFrom(row: DriverApplicationRow): DriverApplicationRecord {
  return {
    id: row.id,
    applicantUserId: row.applicant_user_id,
    tenantId: row.tenant_id,
    facilityId: row.facility_id,
    licenceNumber: row.licence_number,
    licenceExpiresOn: row.licence_expires_on,
    status: row.status,
    version: row.version,
    ...(row.submitted_at === null ? {} : { submittedAt: row.submitted_at }),
  };
}

function driverFrom(row: DriverRow): DriverRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    licenceNumber: row.licence_number,
    licenceExpiresOn: row.licence_expires_on,
    verificationStatus: row.verification_status,
    accountStatus: row.account_status,
    dutyStatus: row.duty_status,
    facilityIds: Object.freeze([...row.facility_ids]),
    eligibilityReasons: Object.freeze([...row.eligibility_reasons]),
    version: row.version,
  };
}

function ambulanceFrom(row: AmbulanceRow): AmbulanceRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    facilityId: row.facility_id,
    plateNumber: row.plate_number,
    ...(row.vin === null ? {} : { vin: row.vin }),
    category: row.category,
    complianceStatus: row.compliance_status,
    operationalStatus: row.operational_status,
    gpsQuality: row.gps_quality,
    readinessStatus: row.readiness_status,
    readinessReasons: Object.freeze([...row.effective_readiness_reasons]),
    readinessVersion: row.readiness_version,
    version: row.version,
  };
}

function maintenanceFrom(row: MaintenanceRow): MaintenanceRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    facilityId: row.facility_id,
    ambulanceId: row.ambulance_id,
    maintenanceType: row.maintenance_type,
    status: row.status,
    scheduledFor: row.scheduled_for,
    ...(row.odometer_meters === null ? {} : { odometerMeters: Number(row.odometer_meters) }),
    notes: row.notes,
    version: row.version,
  };
}

function returnedRow<T>(rows: readonly T[], operation: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`Database did not return the ${operation} row`);
  }
  return row;
}

@Injectable()
export class PostgresProviderOperationsRepository implements ProviderOperationsRepository {
  async listProviderOrganizations(
    transaction: TransactionContext,
  ): Promise<readonly ProviderOrganizationRecord[]> {
    const rows: ProviderOrganizationRow[] = await entityManagerFor(transaction).query(
      `SELECT id, legal_name, display_name, registration_number, operating_status, version
         FROM tenancy.provider_organizations ORDER BY display_name, id`,
    );
    return rows.map((row) => ({
      id: row.id,
      legalName: row.legal_name,
      displayName: row.display_name,
      ...(row.registration_number === null ? {} : { registrationNumber: row.registration_number }),
      operatingStatus: row.operating_status,
      version: row.version,
    }));
  }

  async listFacilities(transaction: TransactionContext): Promise<readonly FacilityRecord[]> {
    const rows: FacilityRow[] = await entityManagerFor(transaction).query(
      `SELECT id, tenant_id, geographic_unit_id, name, facility_type, operating_status,
              public_phone, version
         FROM tenancy.facilities ORDER BY name, id`,
    );
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      geographicUnitId: row.geographic_unit_id,
      name: row.name,
      facilityType: row.facility_type,
      operatingStatus: row.operating_status,
      ...(row.public_phone === null ? {} : { publicPhone: row.public_phone }),
      version: row.version,
    }));
  }

  async createProviderApplication(
    transaction: TransactionContext,
    input: Parameters<ProviderOperationsRepository['createProviderApplication']>[1],
  ): Promise<ProviderApplicationRecord> {
    const rows: ProviderApplicationRow[] = await entityManagerFor(transaction).query(
      `INSERT INTO provider_registry.provider_applications (
         id, applicant_user_id, legal_name, display_name, registration_number,
         geographic_unit_id, facility_name, facility_type, public_phone, status,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT',$10,$10)
       RETURNING *`,
      [
        input.id,
        input.applicantUserId,
        input.legalName,
        input.displayName,
        input.registrationNumber,
        input.geographicUnitId,
        input.facilityName,
        input.facilityType,
        input.publicPhone ?? null,
        input.now,
      ],
    );
    return providerApplicationFrom(returnedRow(rows, 'created provider application'));
  }

  async findProviderApplication(
    transaction: TransactionContext,
    applicationId: string,
  ): Promise<ProviderApplicationRecord | undefined> {
    const rows: ProviderApplicationRow[] = await entityManagerFor(transaction).query(
      `${PROVIDER_APPLICATION_SELECT} WHERE id = $1`,
      [applicationId],
    );
    return rows[0] === undefined ? undefined : providerApplicationFrom(rows[0]);
  }

  async listProviderApplications(
    transaction: TransactionContext,
    statuses?: readonly ProviderApplicationRecord['status'][],
  ): Promise<readonly ProviderApplicationRecord[]> {
    const rows: ProviderApplicationRow[] = await entityManagerFor(transaction).query(
      `${PROVIDER_APPLICATION_SELECT}
        WHERE ($1::varchar[] IS NULL OR status = ANY($1::varchar[]))
        ORDER BY submitted_at NULLS LAST, id`,
      [statuses === undefined ? null : [...statuses]],
    );
    return rows.map(providerApplicationFrom);
  }

  async updateProviderApplicationDraft(
    transaction: TransactionContext,
    input: Parameters<ProviderOperationsRepository['updateProviderApplicationDraft']>[1],
  ): Promise<ProviderApplicationRecord | undefined> {
    const rows: ProviderApplicationRow[] = await entityManagerFor(transaction).query(
      `UPDATE provider_registry.provider_applications
          SET legal_name = $4, display_name = $5, registration_number = $6,
              geographic_unit_id = $7, facility_name = $8, facility_type = $9,
              public_phone = $10, version = version + 1, updated_at = $11
        WHERE id = $1 AND applicant_user_id = $2 AND version = $3
          AND status IN ('DRAFT','NEEDS_INFORMATION')
        RETURNING *`,
      [
        input.applicationId,
        input.applicantUserId,
        input.expectedVersion,
        input.legalName,
        input.displayName,
        input.registrationNumber,
        input.geographicUnitId,
        input.facilityName,
        input.facilityType,
        input.publicPhone ?? null,
        input.now,
      ],
    );
    return rows[0] === undefined ? undefined : providerApplicationFrom(rows[0]);
  }

  async transitionProviderApplication(
    transaction: TransactionContext,
    input: Parameters<ProviderOperationsRepository['transitionProviderApplication']>[1],
  ): Promise<ProviderApplicationRecord | undefined> {
    const rows: ProviderApplicationRow[] = await entityManagerFor(transaction).query(
      `UPDATE provider_registry.provider_applications
          SET status = $4, version = version + 1,
              submitted_at = CASE WHEN $4 = 'SUBMITTED' THEN COALESCE(submitted_at, $5)
                                  ELSE submitted_at END,
              decided_at = CASE WHEN $4 IN ('REJECTED','WITHDRAWN') THEN $5 ELSE decided_at END,
              updated_at = $5
        WHERE id = $1 AND version = $2 AND status = ANY($3::varchar[])
        RETURNING *`,
      [
        input.applicationId,
        input.expectedVersion,
        [...input.fromStatuses],
        input.toStatus,
        input.now,
      ],
    );
    return rows[0] === undefined ? undefined : providerApplicationFrom(rows[0]);
  }

  async recordProviderReview(
    transaction: TransactionContext,
    input: Parameters<ProviderOperationsRepository['recordProviderReview']>[1],
  ): Promise<void> {
    await entityManagerFor(transaction).query(
      `INSERT INTO provider_registry.provider_application_reviews (
         id, application_id, reviewer_user_id, authority_grant_id, decision, reason,
         from_status, to_status, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.id,
        input.applicationId,
        input.reviewerUserId,
        input.authorityGrantId,
        input.decision,
        input.reason,
        input.fromStatus,
        input.toStatus,
        input.createdAt,
      ],
    );
  }

  async approveProviderApplication(
    transaction: TransactionContext,
    input: Parameters<ProviderOperationsRepository['approveProviderApplication']>[1],
  ): Promise<ProviderApplicationRecord | undefined> {
    const result: { approved: boolean }[] = await entityManagerFor(transaction).query(
      `SELECT provider_registry.approve_provider_application(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
       ) AS approved`,
      [
        input.applicationId,
        input.expectedVersion,
        input.reviewId,
        input.tenantId,
        input.facilityId,
        input.membershipId,
        input.accessAssignmentId,
        input.reviewerUserId,
        input.authorityGrantId,
        input.reason,
        input.now,
        input.assignmentValidUntil,
      ],
    );
    if (result[0]?.approved !== true) return undefined;
    return this.findProviderApplication(transaction, input.applicationId);
  }

  async createDriverApplication(
    transaction: TransactionContext,
    input: Parameters<ProviderOperationsRepository['createDriverApplication']>[1],
  ): Promise<DriverApplicationRecord> {
    const rows: DriverApplicationRow[] = await entityManagerFor(transaction).query(
      `INSERT INTO workforce.driver_applications (
         id, applicant_user_id, tenant_id, facility_id, licence_number,
         licence_expires_on, status, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$7) RETURNING *`,
      [
        input.id,
        input.applicantUserId,
        input.tenantId,
        input.facilityId,
        input.licenceNumber,
        input.licenceExpiresOn,
        input.now,
      ],
    );
    return driverApplicationFrom(returnedRow(rows, 'created driver application'));
  }

  async listDriverApplications(
    transaction: TransactionContext,
    applicantUserId?: string,
  ): Promise<readonly DriverApplicationRecord[]> {
    const rows: DriverApplicationRow[] = await entityManagerFor(transaction).query(
      `${DRIVER_APPLICATION_SELECT}
        WHERE ($1::uuid IS NULL OR applicant_user_id = $1)
        ORDER BY created_at DESC, id`,
      [applicantUserId ?? null],
    );
    return rows.map(driverApplicationFrom);
  }

  async findDriverApplication(
    transaction: TransactionContext,
    applicationId: string,
  ): Promise<DriverApplicationRecord | undefined> {
    const rows: DriverApplicationRow[] = await entityManagerFor(transaction).query(
      `${DRIVER_APPLICATION_SELECT} WHERE id = $1`,
      [applicationId],
    );
    return rows[0] === undefined ? undefined : driverApplicationFrom(rows[0]);
  }

  async transitionDriverApplication(
    transaction: TransactionContext,
    input: Parameters<ProviderOperationsRepository['transitionDriverApplication']>[1],
  ): Promise<DriverApplicationRecord | undefined> {
    const manager = entityManagerFor(transaction);
    const rows: DriverApplicationRow[] = await manager.query(
      `UPDATE workforce.driver_applications
          SET status = $4, version = version + 1,
              submitted_at = CASE WHEN $4 = 'SUBMITTED' THEN COALESCE(submitted_at, $5)
                                  ELSE submitted_at END,
              decided_at = CASE WHEN $4 IN ('REJECTED','WITHDRAWN') THEN $5 ELSE decided_at END,
              updated_at = $5
        WHERE id = $1 AND version = $2 AND status = ANY($3::varchar[])
        RETURNING *`,
      [
        input.applicationId,
        input.expectedVersion,
        [...input.fromStatuses],
        input.toStatus,
        input.now,
      ],
    );
    const changed = rows[0];
    if (changed === undefined) return undefined;
    if (input.reviewerUserId !== undefined && input.reason !== undefined) {
      await manager.query(
        `INSERT INTO workforce.driver_application_reviews (
           id, tenant_id, facility_id, application_id, reviewer_user_id, decision, reason, created_at
         ) VALUES (
           gen_random_uuid(), $1, $2, $3, $4,
           CASE WHEN $5 = 'REJECTED' THEN 'REJECTED' ELSE 'INFORMATION_REQUESTED' END,
           $6, $7
         )`,
        [
          changed.tenant_id,
          changed.facility_id,
          changed.id,
          input.reviewerUserId,
          input.toStatus,
          input.reason,
          input.now,
        ],
      );
    }
    return driverApplicationFrom(changed);
  }

  async approveDriverApplication(
    transaction: TransactionContext,
    input: Parameters<ProviderOperationsRepository['approveDriverApplication']>[1],
  ): Promise<DriverRecord | undefined> {
    const manager = entityManagerFor(transaction);
    const locked: DriverApplicationRow[] = await manager.query(
      `${DRIVER_APPLICATION_SELECT}
        WHERE id = $1 AND version = $2 AND status = 'SUBMITTED' FOR UPDATE`,
      [input.applicationId, input.expectedVersion],
    );
    const application = locked[0];
    if (application === undefined || application.applicant_user_id === input.reviewerUserId) {
      return undefined;
    }
    await manager.query(
      `INSERT INTO workforce.driver_profiles (
         id, tenant_id, user_id, licence_number, licence_expires_on,
         verification_status, account_status, duty_status, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,'VERIFIED','ACTIVE','OFF_DUTY',$6,$6)`,
      [
        input.driverId,
        application.tenant_id,
        application.applicant_user_id,
        application.licence_number,
        application.licence_expires_on,
        input.now,
      ],
    );
    await manager.query(
      `INSERT INTO workforce.driver_facility_assignments (
         id, tenant_id, facility_id, driver_id, valid_from, created_at
       ) VALUES ($1,$2,$3,$4,$5,$5)`,
      [
        input.affiliationId,
        application.tenant_id,
        application.facility_id,
        input.driverId,
        input.now,
      ],
    );
    await manager.query(
      `INSERT INTO workforce.driver_application_reviews (
         id, tenant_id, facility_id, application_id, reviewer_user_id, decision, reason, created_at
       ) VALUES (gen_random_uuid(),$1,$2,$3,$4,'APPROVED',$5,$6)`,
      [
        application.tenant_id,
        application.facility_id,
        application.id,
        input.reviewerUserId,
        input.reason,
        input.now,
      ],
    );
    await manager.query(
      `UPDATE workforce.driver_applications
          SET status = 'APPROVED', version = version + 1, decided_at = $3, updated_at = $3
        WHERE id = $1 AND version = $2`,
      [input.applicationId, input.expectedVersion, input.now],
    );
    return this.findDriver(transaction, input.driverId);
  }

  async listDrivers(transaction: TransactionContext): Promise<readonly DriverRecord[]> {
    const rows: DriverRow[] = await entityManagerFor(transaction).query(
      `${DRIVER_SELECT} ORDER BY driver.id`,
    );
    return rows.map(driverFrom);
  }

  async findDriver(
    transaction: TransactionContext,
    driverId: string,
  ): Promise<DriverRecord | undefined> {
    const rows: DriverRow[] = await entityManagerFor(transaction).query(
      `${DRIVER_SELECT} WHERE driver.id = $1`,
      [driverId],
    );
    return rows[0] === undefined ? undefined : driverFrom(rows[0]);
  }

  async changeDriverAccountStatus(
    transaction: TransactionContext,
    input: Parameters<ProviderOperationsRepository['changeDriverAccountStatus']>[1],
  ): Promise<DriverRecord | undefined> {
    const rows: { id: string }[] = await entityManagerFor(transaction).query(
      `UPDATE workforce.driver_profiles
          SET account_status = $3,
              duty_status = CASE WHEN $3 = 'ACTIVE' THEN duty_status ELSE 'UNAVAILABLE' END,
              version = version + 1, updated_at = $4
        WHERE id = $1 AND version = $2
          AND NOT (account_status = 'DEACTIVATED' AND $3 <> 'DEACTIVATED')
        RETURNING id`,
      [input.driverId, input.expectedVersion, input.status, input.now],
    );
    return rows[0] === undefined ? undefined : this.findDriver(transaction, rows[0].id);
  }

  async changeDriverDutyStatus(
    transaction: TransactionContext,
    input: Parameters<ProviderOperationsRepository['changeDriverDutyStatus']>[1],
  ): Promise<DriverRecord | undefined> {
    const rows: { id: string }[] = await entityManagerFor(transaction).query(
      `UPDATE workforce.driver_profiles
          SET duty_status = $3, version = version + 1, updated_at = $4
        WHERE id = $1 AND version = $2 AND duty_status NOT IN ('RESERVED','ON_TRIP')
        RETURNING id`,
      [input.driverId, input.expectedVersion, input.status, input.now],
    );
    return rows[0] === undefined ? undefined : this.findDriver(transaction, rows[0].id);
  }

  async createAmbulance(
    transaction: TransactionContext,
    input: Parameters<ProviderOperationsRepository['createAmbulance']>[1],
  ): Promise<AmbulanceRecord> {
    const rows: AmbulanceRow[] = await entityManagerFor(transaction).query(
      `INSERT INTO fleet.ambulances (
         id, tenant_id, facility_id, registered_by_user_id, plate_number, vin, category, compliance_status,
         operational_status, gps_quality, readiness_status, readiness_reasons,
         created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,upper(regexp_replace($5,'\\s+','','g')),$6,$7,'PENDING_REVIEW',
          'OFFLINE','UNAVAILABLE','BLOCKED',ARRAY['COMPLIANCE_NOT_APPROVED']::varchar[],$8,$8
        ) RETURNING *,
         array_prepend('NOT_OPERATIONALLY_AVAILABLE'::varchar, readiness_reasons)
           AS effective_readiness_reasons`,
      [
        input.id,
        input.tenantId,
        input.facilityId,
        input.registeredByUserId,
        input.plateNumber,
        input.vin ?? null,
        input.category,
        input.now,
      ],
    );
    return ambulanceFrom(returnedRow(rows, 'created ambulance'));
  }

  async listAmbulances(transaction: TransactionContext): Promise<readonly AmbulanceRecord[]> {
    const rows: AmbulanceRow[] = await entityManagerFor(transaction).query(
      `${AMBULANCE_SELECT} ORDER BY ambulance.id`,
    );
    return rows.map(ambulanceFrom);
  }

  async findAmbulance(
    transaction: TransactionContext,
    ambulanceId: string,
  ): Promise<AmbulanceRecord | undefined> {
    const rows: AmbulanceRow[] = await entityManagerFor(transaction).query(
      `${AMBULANCE_SELECT} WHERE ambulance.id = $1`,
      [ambulanceId],
    );
    return rows[0] === undefined ? undefined : ambulanceFrom(rows[0]);
  }

  async updateAmbulance(
    transaction: TransactionContext,
    input: Parameters<ProviderOperationsRepository['updateAmbulance']>[1],
  ): Promise<AmbulanceRecord | undefined> {
    const rows: { id: string }[] = await entityManagerFor(transaction).query(
      `UPDATE fleet.ambulances
          SET plate_number = upper(regexp_replace($3,'\\s+','','g')), vin = $4, category = $5,
              version = version + 1, updated_at = $6
        WHERE id = $1 AND version = $2
        RETURNING id`,
      [
        input.ambulanceId,
        input.expectedVersion,
        input.plateNumber,
        input.vin ?? null,
        input.category,
        input.now,
      ],
    );
    return rows[0] === undefined ? undefined : this.findAmbulance(transaction, rows[0].id);
  }

  async changeAmbulanceOperationalStatus(
    transaction: TransactionContext,
    input: Parameters<ProviderOperationsRepository['changeAmbulanceOperationalStatus']>[1],
  ): Promise<AmbulanceRecord | undefined> {
    const rows: { id: string }[] = await entityManagerFor(transaction).query(
      `UPDATE fleet.ambulances
          SET operational_status = $3, version = version + 1, updated_at = $4
        WHERE id = $1 AND version = $2 AND operational_status NOT IN ('RESERVED','DISPATCHED')
        RETURNING id`,
      [input.ambulanceId, input.expectedVersion, input.status, input.now],
    );
    return rows[0] === undefined ? undefined : this.findAmbulance(transaction, rows[0].id);
  }

  async reviewAmbulanceCompliance(
    transaction: TransactionContext,
    input: Parameters<ProviderOperationsRepository['reviewAmbulanceCompliance']>[1],
  ): Promise<AmbulanceRecord | undefined> {
    const rows: { changed: boolean }[] = await entityManagerFor(transaction).query(
      `SELECT fleet.review_ambulance_compliance($1,$2,$3,$4,$5,$6,$7,$8) AS changed`,
      [
        input.ambulanceId,
        input.expectedVersion,
        input.reviewId,
        input.status,
        input.reviewerUserId,
        input.authorityGrantId,
        input.reason,
        input.now,
      ],
    );
    if (rows[0]?.changed !== true) return undefined;
    return this.findAmbulance(transaction, input.ambulanceId);
  }

  async listMaintenanceRecords(
    transaction: TransactionContext,
    ambulanceId: string,
  ): Promise<readonly MaintenanceRecord[]> {
    const rows: MaintenanceRow[] = await entityManagerFor(transaction).query(
      `SELECT id, tenant_id, facility_id, ambulance_id, maintenance_type, status,
              scheduled_for, odometer_meters, notes, version
         FROM fleet.maintenance_records
        WHERE ambulance_id = $1 ORDER BY scheduled_for DESC, id`,
      [ambulanceId],
    );
    return rows.map(maintenanceFrom);
  }

  async createMaintenanceRecord(
    transaction: TransactionContext,
    input: Parameters<ProviderOperationsRepository['createMaintenanceRecord']>[1],
  ): Promise<MaintenanceRecord> {
    const manager = entityManagerFor(transaction);
    const rows: MaintenanceRow[] = await manager.query(
      `INSERT INTO fleet.maintenance_records (
         id, tenant_id, facility_id, ambulance_id, maintenance_type, status,
         scheduled_for, odometer_meters, notes, completed_at, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,
         CASE WHEN $6 = 'COMPLETED' THEN $10 ELSE NULL END,$10,$10
       ) RETURNING *`,
      [
        input.id,
        input.tenantId,
        input.facilityId,
        input.ambulanceId,
        input.maintenanceType,
        input.status,
        input.scheduledFor,
        input.odometerMeters ?? null,
        input.notes,
        input.now,
      ],
    );
    if (input.status === 'IN_PROGRESS') {
      await manager.query(
        `UPDATE fleet.ambulances
            SET operational_status = 'MAINTENANCE', version = version + 1, updated_at = $2
          WHERE id = $1 AND operational_status NOT IN ('RESERVED','DISPATCHED')`,
        [input.ambulanceId, input.now],
      );
    }
    await manager.query('SELECT fleet.refresh_ambulance_readiness($1,$2::date,$3)', [
      input.ambulanceId,
      input.now.toISOString().slice(0, 10),
      input.now,
    ]);
    return maintenanceFrom(returnedRow(rows, 'created maintenance record'));
  }

  async upsertEquipment(
    transaction: TransactionContext,
    input: Parameters<ProviderOperationsRepository['upsertEquipment']>[1],
  ): Promise<void> {
    const manager = entityManagerFor(transaction);
    await manager.query(
      `INSERT INTO fleet.ambulance_equipment (
         id, tenant_id, facility_id, ambulance_id, equipment_type, required, present,
         expires_on, created_at, updated_at
       ) SELECT $1, ambulance.tenant_id, ambulance.facility_id, ambulance.id, $3, $4, $5, $6, $7, $7
           FROM fleet.ambulances ambulance WHERE ambulance.id = $2
       ON CONFLICT (ambulance_id, equipment_type) DO UPDATE
         SET required = EXCLUDED.required, present = EXCLUDED.present,
             expires_on = EXCLUDED.expires_on, version = fleet.ambulance_equipment.version + 1,
             updated_at = EXCLUDED.updated_at`,
      [
        input.id,
        input.ambulanceId,
        input.equipmentType,
        input.required,
        input.present,
        input.expiresOn ?? null,
        input.now,
      ],
    );
    await manager.query('SELECT fleet.refresh_ambulance_readiness($1,$2::date,$3)', [
      input.ambulanceId,
      input.now.toISOString().slice(0, 10),
      input.now,
    ]);
  }
}
