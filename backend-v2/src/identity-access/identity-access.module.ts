import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AUDIT_WRITER, type AuditWriter } from '../shared/application/audit/audit-writer.js';
import {
  IDEMPOTENCY_EXECUTOR,
  type IdempotencyExecutor,
} from '../shared/application/idempotency/idempotency.js';
import { UNIT_OF_WORK, type UnitOfWork } from '../shared/application/persistence/unit-of-work.js';
import { CLOCK, type Clock } from '../shared/domain/clock.js';
import { ID_GENERATOR, type IdGenerator } from '../shared/domain/id-generator.js';
import {
  APP_CONFIG,
  type ApplicationConfig,
} from '../shared/infrastructure/config/application-config.js';
import { AccessAdministrationService } from './application/access-administration.service.js';
import { AuthenticationService } from './application/authentication.service.js';
import { AuthorizationService } from './application/authorization.service.js';
import { MultiFactorAuthenticationService } from './application/multi-factor-authentication.service.js';
import {
  ACCESS_ADMINISTRATION_REPOSITORY,
  type AccessAdministrationRepository,
} from './application/ports/access-administration.repository.js';
import {
  ACCESS_ADMINISTRATION_POLICY,
  type AccessAdministrationPolicy,
} from './application/ports/access-administration-policy.js';
import { AUTHENTICATION_RATE_LIMITER } from './application/ports/authentication-rate-limiter.js';
import {
  ACCESS_TOKEN_ISSUER,
  AUTHENTICATION_CRYPTOGRAPHY,
  type AccessTokenIssuer,
  type AuthenticationCryptography,
} from './application/ports/authentication-cryptography.js';
import {
  MULTI_FACTOR_CRYPTOGRAPHY,
  PASSWORD_VERIFIER,
  type MultiFactorCryptography,
  type PasswordVerifier,
} from './application/ports/multi-factor-cryptography.js';
import {
  MULTI_FACTOR_AUTHENTICATION_REPOSITORY,
  type MultiFactorAuthenticationRepository,
} from './application/ports/multi-factor-authentication.repository.js';
import {
  AUTHENTICATION_POLICY,
  type AuthenticationPolicy,
} from './application/ports/authentication-policy.js';
import {
  AUTHENTICATION_REPOSITORY,
  type AuthenticationRepository,
} from './application/ports/authentication-repository.js';
import {
  AUTHORIZATION_REPOSITORY,
  type AuthorizationRepository,
} from './application/ports/authorization-repository.js';
import { OTP_DELIVERY, type OtpDelivery } from './application/ports/otp-delivery.js';
import { EdDsaAccessTokenService } from './infrastructure/crypto/eddsa-access-token.service.js';
import { AesTotpCryptography } from './infrastructure/crypto/aes-totp-cryptography.js';
import { Argon2PasswordVerifier } from './infrastructure/crypto/argon2-password-verifier.js';
import { HmacAuthenticationCryptography } from './infrastructure/crypto/hmac-authentication-cryptography.js';
import { ConfiguredOtpDelivery } from './infrastructure/delivery/configured-otp-delivery.js';
import { PostgresAccessAdministrationRepository } from './infrastructure/persistence/postgres-access-administration.repository.js';
import { PostgresAuthenticationRepository } from './infrastructure/persistence/postgres-authentication.repository.js';
import { PostgresAuthorizationRepository } from './infrastructure/persistence/postgres-authorization.repository.js';
import { PostgresMultiFactorAuthenticationRepository } from './infrastructure/persistence/postgres-multi-factor-authentication.repository.js';
import { RedisAuthenticationRateLimiter } from './infrastructure/rate-limit/redis-authentication-rate-limiter.js';
import {
  ACCESS_ADMINISTRATION_SERVICE,
  AUTHENTICATION_SERVICE,
  AUTHORIZATION_SERVICE,
  MULTI_FACTOR_AUTHENTICATION_SERVICE,
} from './identity-access.tokens.js';
import {
  AccessAdministrationController,
  AuthorityGrantAdministrationController,
} from './presentation/http/access-administration.controller.js';
import { AuthenticationController } from './presentation/http/authentication.controller.js';
import { AuthorizationGuard } from './presentation/http/authorization.guard.js';
import { MeController } from './presentation/http/me.controller.js';

@Module({
  controllers: [
    AuthenticationController,
    MeController,
    AccessAdministrationController,
    AuthorityGrantAdministrationController,
  ],
  providers: [
    PostgresAccessAdministrationRepository,
    {
      provide: ACCESS_ADMINISTRATION_REPOSITORY,
      useExisting: PostgresAccessAdministrationRepository,
    },
    PostgresAuthenticationRepository,
    { provide: AUTHENTICATION_REPOSITORY, useExisting: PostgresAuthenticationRepository },
    PostgresAuthorizationRepository,
    { provide: AUTHORIZATION_REPOSITORY, useExisting: PostgresAuthorizationRepository },
    PostgresMultiFactorAuthenticationRepository,
    {
      provide: MULTI_FACTOR_AUTHENTICATION_REPOSITORY,
      useExisting: PostgresMultiFactorAuthenticationRepository,
    },
    HmacAuthenticationCryptography,
    { provide: AUTHENTICATION_CRYPTOGRAPHY, useExisting: HmacAuthenticationCryptography },
    EdDsaAccessTokenService,
    { provide: ACCESS_TOKEN_ISSUER, useExisting: EdDsaAccessTokenService },
    Argon2PasswordVerifier,
    { provide: PASSWORD_VERIFIER, useExisting: Argon2PasswordVerifier },
    AesTotpCryptography,
    { provide: MULTI_FACTOR_CRYPTOGRAPHY, useExisting: AesTotpCryptography },
    RedisAuthenticationRateLimiter,
    { provide: AUTHENTICATION_RATE_LIMITER, useExisting: RedisAuthenticationRateLimiter },
    ConfiguredOtpDelivery,
    { provide: OTP_DELIVERY, useExisting: ConfiguredOtpDelivery },
    {
      provide: AUTHENTICATION_POLICY,
      inject: [APP_CONFIG],
      useFactory: (config: ApplicationConfig): AuthenticationPolicy =>
        Object.freeze({
          otpLifetimeSeconds: 300,
          otpMaximumAttempts: 5,
          mfaChallengeLifetimeSeconds: 300,
          mfaEnrollmentLifetimeSeconds: config.authentication.mfaEnrollmentTtlSeconds,
          mfaMaximumAttempts: 5,
          aal2LifetimeSeconds: config.authentication.aal2TtlSeconds,
          refreshTokenTtlSeconds: config.authentication.refreshTokenTtlSeconds,
          sessionIdleTtlSeconds: config.authentication.sessionIdleTtlSeconds,
          sessionAbsoluteTtlSeconds: config.authentication.sessionAbsoluteTtlSeconds,
          ...(config.authentication.fixedDevelopmentOtp === undefined
            ? {}
            : { fixedDevelopmentOtp: config.authentication.fixedDevelopmentOtp }),
        }),
    },
    {
      provide: ACCESS_ADMINISTRATION_POLICY,
      inject: [APP_CONFIG],
      useFactory: (config: ApplicationConfig): AccessAdministrationPolicy =>
        Object.freeze({
          maximumDelegatedAssignmentTtlSeconds:
            config.authentication.maximumDelegatedAssignmentTtlSeconds,
          maximumAuthorityGrantTtlSeconds: config.authentication.maximumAuthorityGrantTtlSeconds,
        }),
    },
    {
      provide: ACCESS_ADMINISTRATION_SERVICE,
      inject: [
        ACCESS_ADMINISTRATION_REPOSITORY,
        ACCESS_ADMINISTRATION_POLICY,
        IDEMPOTENCY_EXECUTOR,
        UNIT_OF_WORK,
        AUDIT_WRITER,
        CLOCK,
        ID_GENERATOR,
      ],
      useFactory: (
        repository: AccessAdministrationRepository,
        policy: AccessAdministrationPolicy,
        idempotency: IdempotencyExecutor,
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        clock: Clock,
        ids: IdGenerator,
      ): AccessAdministrationService =>
        new AccessAdministrationService(
          repository,
          policy,
          idempotency,
          unitOfWork,
          audit,
          clock,
          ids,
        ),
    },
    {
      provide: MULTI_FACTOR_AUTHENTICATION_SERVICE,
      inject: [
        MULTI_FACTOR_AUTHENTICATION_REPOSITORY,
        AUTHENTICATION_REPOSITORY,
        PASSWORD_VERIFIER,
        MULTI_FACTOR_CRYPTOGRAPHY,
        AUTHENTICATION_CRYPTOGRAPHY,
        ACCESS_TOKEN_ISSUER,
        AUTHENTICATION_POLICY,
        UNIT_OF_WORK,
        AUDIT_WRITER,
        CLOCK,
        ID_GENERATOR,
      ],
      useFactory: (
        repository: MultiFactorAuthenticationRepository,
        authenticationRepository: AuthenticationRepository,
        passwordVerifier: PasswordVerifier,
        multiFactorCryptography: MultiFactorCryptography,
        authenticationCryptography: AuthenticationCryptography,
        accessTokens: AccessTokenIssuer,
        policy: AuthenticationPolicy,
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        clock: Clock,
        ids: IdGenerator,
      ): MultiFactorAuthenticationService =>
        new MultiFactorAuthenticationService(
          repository,
          authenticationRepository,
          passwordVerifier,
          multiFactorCryptography,
          authenticationCryptography,
          accessTokens,
          policy,
          unitOfWork,
          audit,
          clock,
          ids,
        ),
    },
    {
      provide: AUTHENTICATION_SERVICE,
      inject: [
        AUTHENTICATION_REPOSITORY,
        AUTHENTICATION_CRYPTOGRAPHY,
        ACCESS_TOKEN_ISSUER,
        AUTHENTICATION_POLICY,
        OTP_DELIVERY,
        UNIT_OF_WORK,
        AUDIT_WRITER,
        CLOCK,
        ID_GENERATOR,
      ],
      useFactory: (
        repository: AuthenticationRepository,
        cryptography: AuthenticationCryptography,
        accessTokens: AccessTokenIssuer,
        policy: AuthenticationPolicy,
        delivery: OtpDelivery,
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        clock: Clock,
        ids: IdGenerator,
      ): AuthenticationService =>
        new AuthenticationService(
          repository,
          cryptography,
          accessTokens,
          policy,
          delivery,
          unitOfWork,
          audit,
          clock,
          ids,
        ),
    },
    {
      provide: AUTHORIZATION_SERVICE,
      inject: [
        AUTHENTICATION_REPOSITORY,
        AUTHORIZATION_REPOSITORY,
        ACCESS_TOKEN_ISSUER,
        UNIT_OF_WORK,
        CLOCK,
      ],
      useFactory: (
        authenticationRepository: AuthenticationRepository,
        authorizationRepository: AuthorizationRepository,
        accessTokens: AccessTokenIssuer,
        unitOfWork: UnitOfWork,
        clock: Clock,
      ): AuthorizationService =>
        new AuthorizationService(
          authenticationRepository,
          authorizationRepository,
          accessTokens,
          unitOfWork,
          clock,
        ),
    },
    AuthorizationGuard,
    { provide: APP_GUARD, useExisting: AuthorizationGuard },
  ],
  exports: [
    ACCESS_ADMINISTRATION_SERVICE,
    AUTHENTICATION_SERVICE,
    AUTHORIZATION_SERVICE,
    MULTI_FACTOR_AUTHENTICATION_SERVICE,
    ACCESS_TOKEN_ISSUER,
  ],
})
export class IdentityAccessModule {}
