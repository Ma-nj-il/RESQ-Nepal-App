import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

import type { RoleProfileRecord } from '../../application/ports/access-administration.repository.js';

const SCOPE_CEILINGS: readonly RoleProfileRecord['scopeCeiling'][] = [
  'SELF',
  'ASSIGNED_TRIP',
  'FACILITY_SET',
  'TENANT',
  'PROVINCE_GRANT',
  'PLATFORM_GRANT',
];

const PERMISSION_CODE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const RESOURCE_CLASS = /^[a-z][a-z0-9_]{1,95}$/;

export class RoleMutationDto {
  @IsString()
  @Length(2, 160)
  readonly name!: string;

  @IsString()
  @Length(3, 512)
  readonly description!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(128)
  @Matches(PERMISSION_CODE, { each: true })
  readonly permissionCodes!: string[];

  @IsString()
  @Length(3, 512)
  readonly reason!: string;
}

export class RoleProfileMutationDto {
  @IsString()
  @Length(2, 160)
  readonly name!: string;

  @IsString()
  @Length(3, 512)
  readonly description!: string;

  @IsEnum(SCOPE_CEILINGS)
  readonly scopeCeiling!: RoleProfileRecord['scopeCeiling'];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(64)
  @IsUUID('all', { each: true })
  readonly roleIds!: string[];

  @IsString()
  @Length(3, 512)
  readonly reason!: string;
}

export class RetirementDto {
  @IsString()
  @Length(3, 512)
  readonly reason!: string;
}

export class AssignmentCreationDto {
  @IsUUID('all')
  readonly userId!: string;

  @IsUUID('all')
  readonly roleProfileId!: string;

  @IsEnum(['TENANT', 'FACILITY_SET'])
  readonly scopeType!: 'TENANT' | 'FACILITY_SET';

  @IsArray()
  @ArrayMaxSize(128)
  @IsUUID('all', { each: true })
  readonly facilityIds!: string[];

  @IsISO8601({ strict: true })
  readonly validFrom!: string;

  @IsISO8601({ strict: true })
  readonly validUntil!: string;

  @IsString()
  @Length(3, 512)
  readonly reason!: string;
}

export class AuthorityGrantCreationDto {
  @IsUUID('all')
  readonly subjectUserId!: string;

  @IsUUID('all')
  readonly roleProfileId!: string;

  @IsEnum(['PROVINCE', 'PLATFORM'])
  readonly level!: 'PROVINCE' | 'PLATFORM';

  @IsBoolean()
  readonly nationalScope!: boolean;

  @IsString()
  @Length(3, 512)
  readonly purpose!: string;

  @IsString()
  @Length(3, 1024)
  readonly humanReason!: string;

  @IsISO8601({ strict: true })
  readonly validFrom!: string;

  @IsISO8601({ strict: true })
  readonly expiresAt!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(128)
  @Matches(PERMISSION_CODE, { each: true })
  readonly permissionCodes!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(64)
  @Matches(RESOURCE_CLASS, { each: true })
  readonly resourceClasses!: string[];

  @IsArray()
  @ArrayMaxSize(32)
  @IsUUID('all', { each: true })
  readonly geographicUnitIds!: string[];

  @IsBoolean()
  readonly allowsPii!: boolean;

  @IsBoolean()
  readonly allowsDocumentContent!: boolean;

  @IsBoolean()
  readonly allowsExport!: boolean;

  @IsBoolean()
  readonly allowsIntervention!: boolean;
}

export class RevocationDto {
  @IsString()
  @Length(3, 512)
  readonly reason!: string;
}

export class InvitationDto {
  @IsString()
  @MaxLength(320)
  readonly identifier!: string;
}
