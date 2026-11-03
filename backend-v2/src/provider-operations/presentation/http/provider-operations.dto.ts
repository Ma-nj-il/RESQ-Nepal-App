import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { MaintenanceRecord } from '../../application/ports/provider-operations.repository.js';
import type {
  AmbulanceComplianceStatus,
  AmbulanceOperationalStatus,
  DriverAccountStatus,
  DriverDutyStatus,
} from '../../domain/provider-operations.js';

const SIMPLE_CODE = /^[A-Z][A-Z0-9_]{1,95}$/;
const SHA_256 = /^[a-fA-F0-9]{64}$/;

export class ProviderApplicationMutationDto {
  @IsString()
  @Length(2, 256)
  readonly legalName!: string;

  @IsString()
  @Length(2, 160)
  readonly displayName!: string;

  @IsString()
  @Length(2, 128)
  readonly registrationNumber!: string;

  @IsUUID('all')
  readonly geographicUnitId!: string;

  @IsString()
  @Length(2, 256)
  readonly facilityName!: string;

  @IsString()
  @Matches(SIMPLE_CODE)
  readonly facilityType!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/)
  readonly publicPhone?: string;
}

export class ReasonDto {
  @IsString()
  @Length(3, 1024)
  readonly reason!: string;
}

export class DriverApplicationCreationDto {
  @IsUUID('all')
  readonly tenantId!: string;

  @IsUUID('all')
  readonly facilityId!: string;

  @IsString()
  @Length(3, 128)
  readonly licenceNumber!: string;

  @IsISO8601({ strict: true })
  readonly licenceExpiresOn!: string;
}

export class DriverAccountStatusChangeDto extends ReasonDto {
  @IsEnum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED'])
  readonly status!: DriverAccountStatus;
}

export class DriverDutyStatusChangeDto extends ReasonDto {
  @IsEnum(['OFF_DUTY', 'AVAILABLE', 'UNAVAILABLE'])
  readonly status!: Extract<DriverDutyStatus, 'OFF_DUTY' | 'AVAILABLE' | 'UNAVAILABLE'>;
}

export class AmbulanceMutationDto {
  @IsUUID('all')
  readonly facilityId!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9 -]{3,32}$/)
  readonly plateNumber!: string;

  @IsOptional()
  @IsString()
  @Length(5, 64)
  readonly vin?: string;

  @IsString()
  @Matches(SIMPLE_CODE)
  readonly category!: string;
}

export class AmbulanceUpdateDto {
  @IsString()
  @Matches(/^[A-Za-z0-9 -]{3,32}$/)
  readonly plateNumber!: string;

  @IsOptional()
  @IsString()
  @Length(5, 64)
  readonly vin?: string;

  @IsString()
  @Matches(SIMPLE_CODE)
  readonly category!: string;
}

export class AmbulanceOperationalStatusChangeDto extends ReasonDto {
  @IsEnum(['OFFLINE', 'AVAILABLE', 'MAINTENANCE', 'OUT_OF_SERVICE'])
  readonly status!: Extract<
    AmbulanceOperationalStatus,
    'OFFLINE' | 'AVAILABLE' | 'MAINTENANCE' | 'OUT_OF_SERVICE'
  >;
}

export class AmbulanceComplianceReviewDto extends ReasonDto {
  @IsEnum(['APPROVED', 'NEEDS_INFORMATION', 'REJECTED', 'SUSPENDED', 'EXPIRED'])
  readonly status!: Exclude<AmbulanceComplianceStatus, 'PENDING_REVIEW'>;
}

export class MaintenanceCreationDto {
  @IsEnum(['PLANNED', 'UNPLANNED', 'INSPECTION'])
  readonly maintenanceType!: MaintenanceRecord['maintenanceType'];

  @IsEnum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
  readonly status!: MaintenanceRecord['status'];

  @IsISO8601({ strict: true })
  readonly scheduledFor!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  readonly odometerMeters?: number;

  @IsString()
  @Length(3, 2048)
  readonly notes!: string;
}

export class EquipmentUpsertDto {
  @IsString()
  @Matches(SIMPLE_CODE)
  readonly equipmentType!: string;

  @IsBoolean()
  readonly required!: boolean;

  @IsBoolean()
  readonly present!: boolean;

  @IsOptional()
  @IsISO8601({ strict: true })
  readonly expiresOn?: string;
}

export const DOCUMENT_SUBJECT_TYPES = [
  'USER_IDENTITY',
  'PROVIDER_APPLICATION',
  'DRIVER_APPLICATION',
  'DRIVER',
  'AMBULANCE',
  'FACILITY',
] as const;

export class DocumentUploadCreationDto {
  @IsEnum(DOCUMENT_SUBJECT_TYPES)
  readonly subjectType!: (typeof DOCUMENT_SUBJECT_TYPES)[number];

  @IsUUID('all')
  readonly subjectId!: string;

  @IsString()
  @Matches(SIMPLE_CODE)
  readonly documentType!: string;

  @IsString()
  @Matches(SHA_256)
  readonly sha256!: string;

  @IsInt()
  @Min(1)
  @Max(15 * 1024 * 1024)
  readonly sizeBytes!: number;

  @IsString()
  @MaxLength(128)
  readonly mimeType!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  readonly expiresOn?: string;
}

export class DocumentReviewDto extends ReasonDto {
  @IsEnum(['APPROVED', 'NEEDS_INFORMATION', 'REJECTED', 'REVOKED'])
  readonly decision!: 'APPROVED' | 'NEEDS_INFORMATION' | 'REJECTED' | 'REVOKED';
}
