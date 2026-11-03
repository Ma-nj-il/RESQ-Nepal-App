import { IsEnum, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';

import { AUTH_CLIENT_TYPES, type AuthClientType } from '../../domain/authentication.js';
import type { OtpPurpose } from '../../application/ports/authentication-repository.js';

const OTP_PURPOSES: readonly OtpPurpose[] = ['REGISTRATION_OR_LOGIN', 'RECOVERY', 'STEP_UP'];

export class RequestOtpDto {
  @IsString()
  @Length(8, 32)
  readonly phoneNumber!: string;

  @IsEnum(OTP_PURPOSES)
  readonly purpose!: OtpPurpose;
}

export class VerifyOtpDto {
  @IsUUID('all')
  readonly challengeId!: string;

  @Matches(/^\d{6}$/)
  readonly otp!: string;

  @IsEnum(AUTH_CLIENT_TYPES)
  readonly clientType!: AuthClientType;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  readonly deviceLabel?: string;
}

export class RefreshTokenDto {
  @IsOptional()
  @IsString()
  @Length(32, 256)
  readonly refreshToken?: string;
}

export class SessionRevocationsDto {
  @IsEnum(['OTHERS', 'ALL'])
  readonly scope!: 'OTHERS' | 'ALL';
}

export class PasswordSessionDto {
  @IsString()
  @Length(3, 320)
  readonly identifier!: string;

  @IsString()
  @Length(12, 1024)
  readonly password!: string;

  @IsEnum(AUTH_CLIENT_TYPES)
  readonly clientType!: AuthClientType;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  readonly deviceLabel?: string;
}

export class MfaVerificationDto {
  @Matches(/^\d{6}$/)
  readonly code!: string;
}

export class TotpEnrollmentDto {
  @IsString()
  @Length(2, 160)
  readonly label!: string;
}
