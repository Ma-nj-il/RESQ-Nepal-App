import type { AuditWriter } from '../../shared/application/audit/audit-writer.js';
import type { RequestContext } from '../../shared/application/context/request-context.js';
import { ApplicationError } from '../../shared/application/errors/application-error.js';
import type { UnitOfWork } from '../../shared/application/persistence/unit-of-work.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type { AuthClientType, SessionTokens } from '../domain/authentication.js';
import { InvalidPhoneNumberError, normalizePhoneNumber } from '../domain/phone-number.js';
import {
  type AccessTokenIssuer,
  type AuthenticationCryptography,
} from './ports/authentication-cryptography.js';
import { type AuthenticationPolicy } from './ports/authentication-policy.js';
import {
  type AuthenticationRepository,
  type OtpPurpose,
  type OwnedSessionRecord,
} from './ports/authentication-repository.js';
import type { OtpDelivery } from './ports/otp-delivery.js';

function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * 1_000);
}

function earlier(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

type OtpVerificationResult =
  | { readonly kind: 'INVALID'; readonly attemptsExceeded: boolean }
  | {
      readonly kind: 'VERIFIED';
      readonly userId: string;
      readonly sessionId: string;
      readonly tokenVersion: number;
      readonly rawRefreshToken: string;
      readonly refreshExpiresAt: Date;
      readonly assurance: 'AAL1';
    };

type RefreshResult =
  | { readonly kind: 'INVALID'; readonly reason: 'INVALID' | 'EXPIRED' | 'REUSE' }
  | {
      readonly kind: 'ROTATED';
      readonly userId: string;
      readonly sessionId: string;
      readonly tokenVersion: number;
      readonly assurance: 'AAL1' | 'AAL2';
      readonly rawRefreshToken: string;
      readonly refreshExpiresAt: Date;
    };

export class AuthenticationService {
  constructor(
    private readonly repository: AuthenticationRepository,
    private readonly cryptography: AuthenticationCryptography,
    private readonly accessTokens: AccessTokenIssuer,
    private readonly policy: AuthenticationPolicy,
    private readonly otpDelivery: OtpDelivery,
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async requestOtp(
    requestContext: RequestContext,
    input: { readonly phoneNumber: string; readonly purpose: OtpPurpose },
  ): Promise<{ readonly challengeId: string; readonly expiresAt: Date }> {
    if (input.purpose !== 'REGISTRATION_OR_LOGIN') {
      throw new ApplicationError({
        code: 'AUTH.OTP_PURPOSE_UNAVAILABLE',
        message: 'The requested verification flow is unavailable.',
        status: 400,
        details: [{ field: 'purpose', code: 'UNSUPPORTED' }],
      });
    }
    let normalizedPhone: string;
    try {
      normalizedPhone = normalizePhoneNumber(input.phoneNumber);
    } catch (error) {
      if (!(error instanceof InvalidPhoneNumberError)) throw error;
      throw new ApplicationError({
        code: 'AUTH.PHONE_INVALID',
        message: 'The phone number is invalid.',
        status: 400,
        details: [{ field: 'phoneNumber', code: 'INVALID_E164' }],
      });
    }

    const now = this.clock.now();
    const challengeId = this.ids.generate();
    const expiresAt = addSeconds(now, this.policy.otpLifetimeSeconds);
    const otp = this.policy.fixedDevelopmentOtp ?? this.cryptography.generateOtp();
    const digest = this.cryptography.digestOtp(challengeId, normalizedPhone, otp);

    await this.unitOfWork.execute(requestContext, async (transaction) => {
      await this.repository.createOtpChallenge(transaction, {
        id: challengeId,
        normalizedPhone,
        purpose: input.purpose,
        codeDigest: digest,
        maximumAttempts: this.policy.otpMaximumAttempts,
        expiresAt,
        createdAt: now,
      });
    });

    await this.otpDelivery.send({ challengeId, normalizedPhone, otp, expiresAt });
    return { challengeId, expiresAt };
  }

  async verifyOtp(
    requestContext: RequestContext,
    input: {
      readonly challengeId: string;
      readonly otp: string;
      readonly clientType: AuthClientType;
      readonly deviceLabel?: string;
    },
  ): Promise<{ readonly userId: string; readonly tokens: SessionTokens }> {
    const now = this.clock.now();
    const result = await this.unitOfWork.execute<OtpVerificationResult>(
      requestContext,
      async (transaction) => {
        const challenge = await this.repository.findOtpChallengeForUpdate(
          transaction,
          input.challengeId,
        );
        if (
          challenge === undefined ||
          challenge.purpose !== 'REGISTRATION_OR_LOGIN' ||
          challenge.consumedAt !== undefined ||
          challenge.expiresAt.getTime() <= now.getTime() ||
          challenge.attempts >= challenge.maximumAttempts
        ) {
          return { kind: 'INVALID', attemptsExceeded: false };
        }

        const suppliedDigest = this.cryptography.digestOtp(
          challenge.id,
          challenge.normalizedPhone,
          input.otp,
        );
        if (!this.cryptography.equals(challenge.codeDigest, suppliedDigest)) {
          const attempts = await this.repository.recordOtpFailure(transaction, challenge.id, now);
          await this.audit.append(transaction, {
            id: this.ids.generate(),
            occurredAt: now,
            actorType: 'SYSTEM_POLICY',
            action: 'authentication.otp.verify',
            resourceType: 'otp_challenge',
            resourceId: challenge.id,
            outcome: 'DENIED',
            reasonCode: 'AUTH.OTP_INVALID',
            correlationId: requestContext.correlationId,
            source: 'HTTP',
            safeContext: { attempts },
            retentionClass: 'SECURITY',
          });
          return {
            kind: 'INVALID',
            attemptsExceeded: attempts >= challenge.maximumAttempts,
          };
        }

        await this.repository.consumeOtpChallenge(transaction, challenge.id, now);
        const user = await this.repository.findOrCreatePhoneUser(
          transaction,
          challenge.normalizedPhone,
          this.ids.generate(),
          this.ids.generate(),
          this.ids.generate(),
          now,
        );
        if (user.status !== 'ACTIVE') {
          return { kind: 'INVALID', attemptsExceeded: false };
        }
        const sessionId = this.ids.generate();
        const familyId = this.ids.generate();
        const refreshTokenId = this.ids.generate();
        const rawRefreshToken = this.cryptography.generateRefreshToken();
        const refreshExpiresAt = addSeconds(now, this.policy.refreshTokenTtlSeconds);
        const absoluteExpiresAt = addSeconds(now, this.policy.sessionAbsoluteTtlSeconds);
        const idleExpiresAt = earlier(
          addSeconds(now, this.policy.sessionIdleTtlSeconds),
          absoluteExpiresAt,
        );

        await this.repository.createSessionAndRefreshToken(transaction, {
          sessionId,
          userId: user.userId,
          familyId,
          refreshTokenId,
          refreshTokenDigest: this.cryptography.digestRefreshToken(rawRefreshToken),
          refreshTokenExpiresAt: earlier(refreshExpiresAt, absoluteExpiresAt),
          clientType: input.clientType,
          ...(input.deviceLabel === undefined ? {} : { deviceLabel: input.deviceLabel }),
          assurance: 'AAL1',
          idleExpiresAt,
          absoluteExpiresAt,
          now,
        });
        await this.audit.append(transaction, {
          id: this.ids.generate(),
          occurredAt: now,
          actorType: 'USER',
          actorId: user.userId,
          sessionId,
          authenticationAssurance: 'AAL1',
          action: 'authentication.session.create',
          resourceType: 'auth_session',
          resourceId: sessionId,
          outcome: 'ALLOWED',
          reasonCode: user.created ? 'AUTH.USER_REGISTERED' : 'AUTH.LOGIN_SUCCEEDED',
          correlationId: requestContext.correlationId,
          source: 'HTTP',
          retentionClass: 'SECURITY',
        });
        return {
          kind: 'VERIFIED',
          userId: user.userId,
          sessionId,
          tokenVersion: user.tokenVersion,
          rawRefreshToken,
          refreshExpiresAt: earlier(refreshExpiresAt, absoluteExpiresAt),
          assurance: 'AAL1',
        };
      },
    );

    if (result.kind === 'INVALID') {
      throw new ApplicationError({
        code: result.attemptsExceeded ? 'AUTH.OTP_ATTEMPTS_EXCEEDED' : 'AUTH.OTP_INVALID',
        message: 'The verification code is invalid or expired.',
        status: result.attemptsExceeded ? 429 : 401,
      });
    }

    const access = this.accessTokens.issue({
      userId: result.userId,
      sessionId: result.sessionId,
      assurance: result.assurance,
      tokenVersion: result.tokenVersion,
      authenticationMethods: ['otp'],
      now,
      tokenId: this.ids.generate(),
    });
    return {
      userId: result.userId,
      tokens: {
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        refreshToken: result.rawRefreshToken,
        refreshTokenExpiresAt: result.refreshExpiresAt,
        sessionId: result.sessionId,
        assurance: result.assurance,
      },
    };
  }

  async refresh(
    requestContext: RequestContext,
    rawRefreshToken: string,
  ): Promise<{ readonly userId: string; readonly tokens: SessionTokens }> {
    const now = this.clock.now();
    const digest = this.cryptography.digestRefreshToken(rawRefreshToken);
    const result = await this.unitOfWork.execute<RefreshResult>(
      requestContext,
      async (transaction) => {
        const current = await this.repository.findRefreshTokenForUpdate(transaction, digest);
        if (
          current === undefined ||
          current.revokedAt !== undefined ||
          current.sessionRevokedAt !== undefined
        ) {
          return { kind: 'INVALID', reason: 'INVALID' };
        }
        if (current.consumedAt !== undefined) {
          const effectiveAssurance = this.effectiveAssurance(
            current.assurance,
            current.assuranceExpiresAt,
            now,
          );
          await this.repository.revokeRefreshFamily(
            transaction,
            current.familyId,
            now,
            'REFRESH_TOKEN_REUSE',
          );
          await this.audit.append(transaction, {
            id: this.ids.generate(),
            occurredAt: now,
            actorType: 'USER',
            actorId: current.userId,
            sessionId: current.sessionId,
            authenticationAssurance: effectiveAssurance,
            action: 'authentication.refresh.reuse',
            resourceType: 'auth_session',
            resourceId: current.sessionId,
            outcome: 'DENIED',
            reasonCode: 'AUTH.REFRESH_TOKEN_REUSED',
            correlationId: requestContext.correlationId,
            source: 'HTTP',
            retentionClass: 'SECURITY',
          });
          return { kind: 'INVALID', reason: 'REUSE' };
        }
        if (
          current.expiresAt.getTime() <= now.getTime() ||
          current.sessionIdleExpiresAt.getTime() <= now.getTime() ||
          current.sessionAbsoluteExpiresAt.getTime() <= now.getTime()
        ) {
          return { kind: 'INVALID', reason: 'EXPIRED' };
        }

        const successorTokenId = this.ids.generate();
        const successor = this.cryptography.generateRefreshToken();
        const successorExpiresAt = earlier(
          addSeconds(now, this.policy.refreshTokenTtlSeconds),
          current.sessionAbsoluteExpiresAt,
        );
        const idleExpiresAt = earlier(
          addSeconds(now, this.policy.sessionIdleTtlSeconds),
          current.sessionAbsoluteExpiresAt,
        );
        const assurance = this.effectiveAssurance(
          current.assurance,
          current.assuranceExpiresAt,
          now,
        );
        const assuranceExpiresAt = assurance === 'AAL2' ? current.assuranceExpiresAt : undefined;
        await this.repository.rotateRefreshToken(transaction, {
          consumedTokenId: current.id,
          successorTokenId,
          successorDigest: this.cryptography.digestRefreshToken(successor),
          successorExpiresAt,
          sessionId: current.sessionId,
          familyId: current.familyId,
          now,
          idleExpiresAt,
          assurance,
          ...(assuranceExpiresAt === undefined ? {} : { assuranceExpiresAt }),
        });
        return {
          kind: 'ROTATED',
          userId: current.userId,
          sessionId: current.sessionId,
          tokenVersion: current.tokenVersion,
          assurance,
          rawRefreshToken: successor,
          refreshExpiresAt: successorExpiresAt,
        };
      },
    );

    if (result.kind === 'INVALID') {
      throw new ApplicationError({
        code:
          result.reason === 'REUSE'
            ? 'AUTH.REFRESH_TOKEN_REUSED'
            : result.reason === 'EXPIRED'
              ? 'AUTH.REFRESH_TOKEN_EXPIRED'
              : 'AUTH.REFRESH_TOKEN_INVALID',
        message: 'The refresh session is no longer valid.',
        status: 401,
      });
    }

    const access = this.accessTokens.issue({
      userId: result.userId,
      sessionId: result.sessionId,
      assurance: result.assurance,
      tokenVersion: result.tokenVersion,
      authenticationMethods: result.assurance === 'AAL2' ? ['otp', 'totp'] : ['otp'],
      now,
      tokenId: this.ids.generate(),
    });
    return {
      userId: result.userId,
      tokens: {
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        refreshToken: result.rawRefreshToken,
        refreshTokenExpiresAt: result.refreshExpiresAt,
        sessionId: result.sessionId,
        assurance: result.assurance,
      },
    };
  }

  async revokeCurrentSession(requestContext: RequestContext): Promise<void> {
    const userId = requestContext.actor?.type === 'USER' ? requestContext.actor.id : undefined;
    if (userId === undefined || requestContext.sessionId === undefined) {
      throw new ApplicationError({
        code: 'AUTH.AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.',
        status: 401,
      });
    }
    const sessionId = requestContext.sessionId;
    const now = this.clock.now();
    await this.unitOfWork.execute(requestContext, async (transaction) => {
      await this.repository.revokeSession(transaction, userId, sessionId, now, 'USER_LOGOUT');
    });
  }

  async listSessions(requestContext: RequestContext): Promise<readonly OwnedSessionRecord[]> {
    const userId = requestContext.actor?.type === 'USER' ? requestContext.actor.id : undefined;
    if (userId === undefined || requestContext.sessionId === undefined) {
      throw new ApplicationError({
        code: 'AUTH.AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.',
        status: 401,
      });
    }
    const sessionId = requestContext.sessionId;
    return this.unitOfWork.execute(requestContext, (transaction) =>
      this.repository.listOwnedSessions(transaction, userId, sessionId),
    );
  }

  async revokeOwnedSession(requestContext: RequestContext, sessionId: string): Promise<void> {
    const userId = requestContext.actor?.type === 'USER' ? requestContext.actor.id : undefined;
    if (userId === undefined) {
      throw new ApplicationError({
        code: 'AUTH.AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.',
        status: 401,
      });
    }
    const revoked = await this.unitOfWork.execute(requestContext, (transaction) =>
      this.repository.revokeSession(
        transaction,
        userId,
        sessionId,
        this.clock.now(),
        'USER_SESSION_REVOCATION',
      ),
    );
    if (!revoked) {
      throw new ApplicationError({
        code: 'RESOURCE.NOT_FOUND',
        message: 'The requested resource was not found.',
        status: 404,
      });
    }
  }

  async revokeSessions(requestContext: RequestContext, includeCurrent: boolean): Promise<number> {
    const userId = requestContext.actor?.type === 'USER' ? requestContext.actor.id : undefined;
    if (userId === undefined || requestContext.sessionId === undefined) {
      throw new ApplicationError({
        code: 'AUTH.AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.',
        status: 401,
      });
    }
    const sessionId = requestContext.sessionId;
    return this.unitOfWork.execute(requestContext, (transaction) =>
      this.repository.revokeOtherSessions(
        transaction,
        userId,
        sessionId,
        includeCurrent,
        this.clock.now(),
        includeCurrent ? 'USER_REVOKE_ALL' : 'USER_REVOKE_OTHERS',
      ),
    );
  }

  private effectiveAssurance(
    assurance: 'AAL1' | 'AAL2',
    assuranceExpiresAt: Date | undefined,
    now: Date,
  ): 'AAL1' | 'AAL2' {
    return assurance === 'AAL2' &&
      assuranceExpiresAt !== undefined &&
      assuranceExpiresAt.getTime() > now.getTime()
      ? 'AAL2'
      : 'AAL1';
  }
}
