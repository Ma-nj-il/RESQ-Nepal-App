import type { TransactionContext } from '../../../shared/application/persistence/unit-of-work.js';
import type {
  AmbulanceComplianceStatus,
  AmbulanceOperationalStatus,
  DriverAccountStatus,
  DriverDutyStatus,
  DriverVerificationStatus,
  ProviderApplicationStatus,
} from '../../domain/provider-operations.js';

export interface ProviderApplicationRecord {
  readonly id: string;
  readonly applicantUserId: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly registrationNumber: string;
  readonly geographicUnitId: string;
  readonly facilityName: string;
  readonly facilityType: string;
  readonly publicPhone?: string;
  readonly status: ProviderApplicationStatus;
  readonly version: number;
  readonly submittedAt?: Date;
  readonly decidedAt?: Date;
  readonly tenantId?: string;
  readonly facilityId?: string;
}

export interface ProviderApplicationReviewRecord {
  readonly id: string;
  readonly applicationId: string;
  readonly reviewerUserId: string;
  readonly authorityGrantId: string;
  readonly decision:
    'INFORMATION_REQUESTED' | 'RECOMMENDED' | 'PLATFORM_REVIEW_STARTED' | 'APPROVED' | 'REJECTED';
  readonly reason: string;
  readonly fromStatus: ProviderApplicationStatus;
  readonly toStatus: ProviderApplicationStatus;
  readonly createdAt: Date;
}

export interface ProviderOrganizationRecord {
  readonly id: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly registrationNumber?: string;
  readonly operatingStatus: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  readonly version: number;
}

export interface FacilityRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly geographicUnitId: string;
  readonly name: string;
  readonly facilityType: string;
  readonly operatingStatus: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  readonly publicPhone?: string;
  readonly version: number;
}

export interface DriverApplicationRecord {
  readonly id: string;
  readonly applicantUserId: string;
  readonly tenantId: string;
  readonly facilityId: string;
  readonly licenceNumber: string;
  readonly licenceExpiresOn: string;
  readonly status:
    'DRAFT' | 'SUBMITTED' | 'NEEDS_INFORMATION' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  readonly version: number;
  readonly submittedAt?: Date;
}

export interface DriverRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly licenceNumber: string;
  readonly licenceExpiresOn: string;
  readonly verificationStatus: DriverVerificationStatus;
  readonly accountStatus: DriverAccountStatus;
  readonly dutyStatus: DriverDutyStatus;
  readonly facilityIds: readonly string[];
  readonly eligibilityReasons: readonly string[];
  readonly version: number;
}

export interface AmbulanceRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly facilityId: string;
  readonly plateNumber: string;
  readonly vin?: string;
  readonly category: string;
  readonly complianceStatus: AmbulanceComplianceStatus;
  readonly operationalStatus: AmbulanceOperationalStatus;
  readonly gpsQuality: 'LIVE' | 'LAST_KNOWN' | 'STALE' | 'UNAVAILABLE';
  readonly readinessStatus: 'READY' | 'BLOCKED';
  readonly readinessReasons: readonly string[];
  readonly readinessVersion: number;
  readonly version: number;
}

export interface MaintenanceRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly facilityId: string;
  readonly ambulanceId: string;
  readonly maintenanceType: 'PLANNED' | 'UNPLANNED' | 'INSPECTION';
  readonly status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  readonly scheduledFor: Date;
  readonly odometerMeters?: number;
  readonly notes: string;
  readonly version: number;
}

export interface ProviderOperationsRepository {
  listProviderOrganizations(
    transaction: TransactionContext,
  ): Promise<readonly ProviderOrganizationRecord[]>;
  listFacilities(transaction: TransactionContext): Promise<readonly FacilityRecord[]>;
  createProviderApplication(
    transaction: TransactionContext,
    input: Omit<ProviderApplicationRecord, 'status' | 'version'> & { readonly now: Date },
  ): Promise<ProviderApplicationRecord>;
  findProviderApplication(
    transaction: TransactionContext,
    applicationId: string,
  ): Promise<ProviderApplicationRecord | undefined>;
  listProviderApplications(
    transaction: TransactionContext,
    statuses?: readonly ProviderApplicationStatus[],
  ): Promise<readonly ProviderApplicationRecord[]>;
  updateProviderApplicationDraft(
    transaction: TransactionContext,
    input: {
      readonly applicationId: string;
      readonly applicantUserId: string;
      readonly expectedVersion: number;
      readonly legalName: string;
      readonly displayName: string;
      readonly registrationNumber: string;
      readonly geographicUnitId: string;
      readonly facilityName: string;
      readonly facilityType: string;
      readonly publicPhone?: string;
      readonly now: Date;
    },
  ): Promise<ProviderApplicationRecord | undefined>;
  transitionProviderApplication(
    transaction: TransactionContext,
    input: {
      readonly applicationId: string;
      readonly expectedVersion: number;
      readonly fromStatuses: readonly ProviderApplicationStatus[];
      readonly toStatus: ProviderApplicationStatus;
      readonly now: Date;
    },
  ): Promise<ProviderApplicationRecord | undefined>;
  recordProviderReview(
    transaction: TransactionContext,
    input: ProviderApplicationReviewRecord,
  ): Promise<void>;
  approveProviderApplication(
    transaction: TransactionContext,
    input: {
      readonly applicationId: string;
      readonly expectedVersion: number;
      readonly reviewId: string;
      readonly tenantId: string;
      readonly facilityId: string;
      readonly membershipId: string;
      readonly accessAssignmentId: string;
      readonly reviewerUserId: string;
      readonly authorityGrantId: string;
      readonly reason: string;
      readonly now: Date;
      readonly assignmentValidUntil: Date;
    },
  ): Promise<ProviderApplicationRecord | undefined>;

  createDriverApplication(
    transaction: TransactionContext,
    input: Omit<DriverApplicationRecord, 'status' | 'version'> & { readonly now: Date },
  ): Promise<DriverApplicationRecord>;
  listDriverApplications(
    transaction: TransactionContext,
    applicantUserId?: string,
  ): Promise<readonly DriverApplicationRecord[]>;
  findDriverApplication(
    transaction: TransactionContext,
    applicationId: string,
  ): Promise<DriverApplicationRecord | undefined>;
  transitionDriverApplication(
    transaction: TransactionContext,
    input: {
      readonly applicationId: string;
      readonly expectedVersion: number;
      readonly fromStatuses: readonly DriverApplicationRecord['status'][];
      readonly toStatus: DriverApplicationRecord['status'];
      readonly reviewerUserId?: string;
      readonly reason?: string;
      readonly now: Date;
    },
  ): Promise<DriverApplicationRecord | undefined>;
  approveDriverApplication(
    transaction: TransactionContext,
    input: {
      readonly applicationId: string;
      readonly expectedVersion: number;
      readonly driverId: string;
      readonly affiliationId: string;
      readonly reviewerUserId: string;
      readonly reason: string;
      readonly now: Date;
    },
  ): Promise<DriverRecord | undefined>;
  listDrivers(transaction: TransactionContext): Promise<readonly DriverRecord[]>;
  findDriver(transaction: TransactionContext, driverId: string): Promise<DriverRecord | undefined>;
  changeDriverAccountStatus(
    transaction: TransactionContext,
    input: {
      readonly driverId: string;
      readonly expectedVersion: number;
      readonly status: DriverAccountStatus;
      readonly now: Date;
    },
  ): Promise<DriverRecord | undefined>;
  changeDriverDutyStatus(
    transaction: TransactionContext,
    input: {
      readonly driverId: string;
      readonly expectedVersion: number;
      readonly status: DriverDutyStatus;
      readonly now: Date;
    },
  ): Promise<DriverRecord | undefined>;

  createAmbulance(
    transaction: TransactionContext,
    input: {
      readonly id: string;
      readonly tenantId: string;
      readonly facilityId: string;
      readonly registeredByUserId: string;
      readonly plateNumber: string;
      readonly vin?: string;
      readonly category: string;
      readonly now: Date;
    },
  ): Promise<AmbulanceRecord>;
  listAmbulances(transaction: TransactionContext): Promise<readonly AmbulanceRecord[]>;
  findAmbulance(
    transaction: TransactionContext,
    ambulanceId: string,
  ): Promise<AmbulanceRecord | undefined>;
  updateAmbulance(
    transaction: TransactionContext,
    input: {
      readonly ambulanceId: string;
      readonly expectedVersion: number;
      readonly plateNumber: string;
      readonly vin?: string;
      readonly category: string;
      readonly now: Date;
    },
  ): Promise<AmbulanceRecord | undefined>;
  changeAmbulanceOperationalStatus(
    transaction: TransactionContext,
    input: {
      readonly ambulanceId: string;
      readonly expectedVersion: number;
      readonly status: AmbulanceOperationalStatus;
      readonly now: Date;
    },
  ): Promise<AmbulanceRecord | undefined>;
  reviewAmbulanceCompliance(
    transaction: TransactionContext,
    input: {
      readonly reviewId: string;
      readonly ambulanceId: string;
      readonly expectedVersion: number;
      readonly status: AmbulanceComplianceStatus;
      readonly reviewerUserId: string;
      readonly authorityGrantId: string;
      readonly reason: string;
      readonly now: Date;
    },
  ): Promise<AmbulanceRecord | undefined>;
  listMaintenanceRecords(
    transaction: TransactionContext,
    ambulanceId: string,
  ): Promise<readonly MaintenanceRecord[]>;
  createMaintenanceRecord(
    transaction: TransactionContext,
    input: Omit<MaintenanceRecord, 'version'> & { readonly now: Date },
  ): Promise<MaintenanceRecord>;
  upsertEquipment(
    transaction: TransactionContext,
    input: {
      readonly id: string;
      readonly ambulanceId: string;
      readonly equipmentType: string;
      readonly required: boolean;
      readonly present: boolean;
      readonly expiresOn?: string;
      readonly now: Date;
    },
  ): Promise<void>;
}

export const PROVIDER_OPERATIONS_REPOSITORY = Symbol('PROVIDER_OPERATIONS_REPOSITORY');
