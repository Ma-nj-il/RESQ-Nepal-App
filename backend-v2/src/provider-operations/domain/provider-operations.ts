export type ProviderApplicationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PROVINCE_REVIEW'
  | 'NEEDS_INFORMATION'
  | 'PROVINCE_RECOMMENDED'
  | 'PLATFORM_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'WITHDRAWN';

export type ProviderApplicationCommand =
  | 'SUBMIT'
  | 'REQUEST_INFORMATION'
  | 'RECOMMEND'
  | 'BEGIN_PLATFORM_REVIEW'
  | 'APPROVE'
  | 'REJECT'
  | 'WITHDRAW';

const providerTransitions: Readonly<
  Record<
    ProviderApplicationCommand,
    Readonly<Partial<Record<ProviderApplicationStatus, ProviderApplicationStatus>>>
  >
> = Object.freeze({
  SUBMIT: Object.freeze({ DRAFT: 'SUBMITTED', NEEDS_INFORMATION: 'SUBMITTED' }),
  REQUEST_INFORMATION: Object.freeze({
    SUBMITTED: 'NEEDS_INFORMATION',
    PROVINCE_REVIEW: 'NEEDS_INFORMATION',
    PLATFORM_REVIEW: 'NEEDS_INFORMATION',
  }),
  RECOMMEND: Object.freeze({
    SUBMITTED: 'PROVINCE_RECOMMENDED',
    PROVINCE_REVIEW: 'PROVINCE_RECOMMENDED',
  }),
  BEGIN_PLATFORM_REVIEW: Object.freeze({ PROVINCE_RECOMMENDED: 'PLATFORM_REVIEW' }),
  APPROVE: Object.freeze({
    PROVINCE_RECOMMENDED: 'APPROVED',
    PLATFORM_REVIEW: 'APPROVED',
  }),
  REJECT: Object.freeze({
    SUBMITTED: 'REJECTED',
    PROVINCE_REVIEW: 'REJECTED',
    PROVINCE_RECOMMENDED: 'REJECTED',
    PLATFORM_REVIEW: 'REJECTED',
  }),
  WITHDRAW: Object.freeze({ DRAFT: 'WITHDRAWN', NEEDS_INFORMATION: 'WITHDRAWN' }),
});

export function transitionProviderApplication(
  current: ProviderApplicationStatus,
  command: ProviderApplicationCommand,
): ProviderApplicationStatus | undefined {
  return providerTransitions[command][current];
}

export type DriverVerificationStatus =
  'PENDING' | 'NEEDS_INFORMATION' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';
export type DriverAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
export type DriverDutyStatus = 'OFF_DUTY' | 'AVAILABLE' | 'RESERVED' | 'ON_TRIP' | 'UNAVAILABLE';
export type AmbulanceComplianceStatus =
  'PENDING_REVIEW' | 'APPROVED' | 'NEEDS_INFORMATION' | 'REJECTED' | 'SUSPENDED' | 'EXPIRED';
export type AmbulanceOperationalStatus =
  'OFFLINE' | 'AVAILABLE' | 'RESERVED' | 'DISPATCHED' | 'MAINTENANCE' | 'OUT_OF_SERVICE';

export interface DriverEligibility {
  readonly verificationStatus: DriverVerificationStatus;
  readonly accountStatus: DriverAccountStatus;
  readonly dutyStatus: DriverDutyStatus;
  readonly affiliationActive: boolean;
  readonly documentsCurrent: boolean;
  readonly activeTrip: boolean;
}

export function driverEligibilityReasons(input: DriverEligibility): readonly string[] {
  const reasons: string[] = [];
  if (input.verificationStatus !== 'VERIFIED') reasons.push('VERIFICATION_NOT_VALID');
  if (input.accountStatus !== 'ACTIVE') reasons.push('ACCOUNT_NOT_ACTIVE');
  if (input.dutyStatus !== 'AVAILABLE') reasons.push('NOT_AVAILABLE_FOR_DUTY');
  if (!input.affiliationActive) reasons.push('NO_ACTIVE_FACILITY_AFFILIATION');
  if (!input.documentsCurrent) reasons.push('DOCUMENTS_NOT_CURRENT');
  if (input.activeTrip) reasons.push('ACTIVE_TRIP_CONFLICT');
  return Object.freeze(reasons);
}

export interface AmbulanceReadiness {
  readonly complianceStatus: AmbulanceComplianceStatus;
  readonly operationalStatus: AmbulanceOperationalStatus;
  readonly documentsCurrent: boolean;
  readonly equipmentReady: boolean;
  readonly maintenanceBlocking: boolean;
  readonly activeTrip: boolean;
}

export function ambulanceReadinessReasons(input: AmbulanceReadiness): readonly string[] {
  const reasons: string[] = [];
  if (input.complianceStatus !== 'APPROVED') reasons.push('COMPLIANCE_NOT_APPROVED');
  if (input.operationalStatus !== 'AVAILABLE') reasons.push('NOT_OPERATIONALLY_AVAILABLE');
  if (!input.documentsCurrent) reasons.push('DOCUMENTS_NOT_CURRENT');
  if (!input.equipmentReady) reasons.push('REQUIRED_EQUIPMENT_NOT_READY');
  if (input.maintenanceBlocking) reasons.push('MAINTENANCE_BLOCK');
  if (input.activeTrip) reasons.push('ACTIVE_TRIP_CONFLICT');
  return Object.freeze(reasons);
}

export type DocumentUploadStatus =
  'PENDING_UPLOAD' | 'UPLOADED' | 'QUARANTINED' | 'SCANNING' | 'READY' | 'FAILED' | 'REMOVED';
export type DocumentReviewStatus =
  | 'NOT_SUBMITTED'
  | 'PENDING'
  | 'APPROVED'
  | 'NEEDS_INFORMATION'
  | 'REJECTED'
  | 'EXPIRED'
  | 'REVOKED';

export function documentIsCurrent(input: {
  readonly uploadStatus: DocumentUploadStatus;
  readonly reviewStatus: DocumentReviewStatus;
  readonly expiresOn?: string;
  readonly today: string;
}): boolean {
  return (
    input.uploadStatus === 'READY' &&
    input.reviewStatus === 'APPROVED' &&
    (input.expiresOn === undefined || input.expiresOn >= input.today)
  );
}
