import type { AuditWriter } from '../../shared/application/audit/audit-writer.js';
import type { RequestContext } from '../../shared/application/context/request-context.js';
import { RequestContext as ResolvedRequestContext } from '../../shared/application/context/request-context.js';
import { ApplicationError } from '../../shared/application/errors/application-error.js';
import type {
  TransactionContext,
  UnitOfWork,
} from '../../shared/application/persistence/unit-of-work.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type { AuthClientType, SessionTokens } from '../domain/authentication.js';
import type {
  AccessTokenIssuer,
  AuthenticationCryptography,
} from './ports/authentication-cryptography.js';
import type { AuthenticationPolicy } from './ports/authentication-policy.js';
import type { AuthenticationRepository } from './ports/authentication-repository.js';
import type {
  MultiFactorCryptography,
  PasswordVerifier,
} from './ports/multi-factor-cryptography.js';
import type {
  MultiFactorAuthenticationRepository,
  MultiFactorChallengeRecord,
  TotpFactorRecord,
} from './ports/multi-factor-authentication.repository.js';

function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * 1_000);
}

function earlier(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

function invalidCredentials(): ApplicationError {
  return new ApplicationError({
    code: 'AUTH.CREDENTIALS_INVALID',
    message: 'The supplied credentials are invalid.',
    status: 401,
  });
}

function invalidMfa(attemptsExceeded = false): ApplicationError {
  return new ApplicationError({
    code: attemptsExceeded ? 'AUTH.MFA_ATTEMPTS_EXCEEDED' : 'AUTH.MFA_INVALID',
    message: 'The multi-factor challenge is invalid or expired.',
    status: attemptsExceeded ? 429 : 401,
  });
}

type ChallengeVerification =
  | { readonly kind: 'INVALID'; readonly attemptsExceeded: boolean }
  | {
      readonly kind: 'LOGIN';
      readonly userId: string;
      readonly sessionId: string;
      readonly tokenVersion: number;
      readonly clientType: AuthClientType;
      readonly rawRefreshToken: string;
      readonly refreshExpiresAt: Date;
    }
  | {
      readonly kind: 'STEP_UP';
      readonly userId: string;
      readonly sessionId: string;
      readonly tokenVersion: number;
    };

export type MultiFactorVerificationResult =
  | {
      readonly kind: 'SESSION';
      readonly userId: string;
      readonly clientType: AuthClientType;
      readonly tokens: SessionTokens;
    }
  | {
      readonly kind: 'STEP_UP';
      readonly userId: string;
      readonly sessionId: string;
      readonly accessToken: string;
      readonly accessTokenExpiresAt: Date;
      readonly assurance: 'AAL2';
    };

export class MultiFactorAuthenticationService {
  constructor(
    private readonly repository: MultiFactorAuthenticationRepository,
    private readonly authenticationRepository: AuthenticationRepository,
    private readonly passwordVerifier: PasswordVerifier,
    private readonly multiFactorCryptography: MultiFactorCryptography,
    private readonly authenticationCryptography: AuthenticationCryptography,
    private readonly accessTokens: AccessTokenIssuer,
    private readonly policy: AuthenticationPolicy,
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async createPasswordChallenge(
    context: RequestContext,
    input: {
      readonly identifier: string;
      readonly password: string;
      readonly clientType: AuthClientType;
      readonly deviceLabel?: string;
    },
  ): Promise<{ readonly challengeId: string; readonly expiresAt: Date }> {
    const normalizedIdentifier = input.identifier.trim().toLowerCase();
    const identity = await this.unitOfWork.execute(context, (transaction) =>
      this.repository.findAdministrativeIdentity(transaction, normalizedIdentifier),
    );
    const passwordValid = await this.passwordVerifier.verify(
      identity?.passwordHash,
      input.password,
    );
    if (!passwordValid || identity?.status !== 'ACTIVE') {
      await this.unitOfWork.execute(context, (transaction) =>
        this.audit.append(transaction, {
          id: this.ids.generate(),
          occurredAt: this.clock.now(),
          actorType: 'SYSTEM_POLICY',
          action: 'authentication.password.verify',
          resourceType: 'authentication_attempt',
          outcome: 'DENIED',
          reasonCode: 'AUTH.CREDENTIALS_INVALID',
          correlationId: context.correlationId,
          source: context.source,
          retentionClass: 'SECURITY',
        }),
      );
      throw invalidCredentials();
    }

    const principalContext = this.principalContext(context, identity.userId);
    const now = this.clock.now();
    const challengeId = this.ids.generate();
    const expiresAt = addSeconds(now, this.policy.mfaChallengeLifetimeSeconds);
    await this.unitOfWork.execute(principalContext, async (transaction) => {
      if (!(await this.repository.hasVerifiedTotpFactor(transaction, identity.userId))) {
        throw new ApplicationError({
          code: 'AUTH.MFA_ENROLLMENT_REQUIRED',
          message: 'Multi-factor enrollment is required before administrative sign-in.',
          status: 403,
        });
      }
      await this.repository.createChallenge(transaction, {
        id: challengeId,
        userId: identity.userId,
        purpose: 'LOGIN',
        authenticationMethod: 'PASSWORD',
        clientType: input.clientType,
        ...(input.deviceLabel === undefined ? {} : { deviceLabel: input.deviceLabel }),
        maximumAttempts: this.policy.mfaMaximumAttempts,
        expiresAt,
        now,
      });
      await this.appendAudit(transaction, principalContext, {
        now,
        action: 'authentication.password.verify',
        resourceType: 'mfa_challenge',
        resourceId: challengeId,
        reasonCode: 'AUTH.PASSWORD_ACCEPTED_MFA_REQUIRED',
      });
    });
    return { challengeId, expiresAt };
  }

  async createStepUpChallenge(
    context: RequestContext,
  ): Promise<{ readonly challengeId: string; readonly expiresAt: Date }> {
    const { userId, sessionId } = this.requireAuthenticatedSession(context);
    const now = this.clock.now();
    const challengeId = this.ids.generate();
    const expiresAt = addSeconds(now, this.policy.mfaChallengeLifetimeSeconds);
    await this.unitOfWork.execute(context, async (transaction) => {
      if (!(await this.repository.hasVerifiedTotpFactor(transaction, userId))) {
        throw new ApplicationError({
          code: 'AUTH.MFA_ENROLLMENT_REQUIRED',
          message: 'Multi-factor enrollment is required.',
          status: 403,
        });
      }
      await this.repository.createChallenge(transaction, {
        id: challengeId,
        userId,
        purpose: 'STEP_UP',
        authenticationMethod: 'SESSION',
        sessionId,
        maximumAttempts: this.policy.mfaMaximumAttempts,
        expiresAt,
        now,
      });
    });
    return { challengeId, expiresAt };
  }

  async verifyChallenge(
    context: RequestContext,
    challengeId: string,
    code: string,
  ): Promise<MultiFactorVerificationResult> {
    const challengeUserId = await this.unitOfWork.execute(context, (transaction) =>
      this.repository.peekChallengeUser(transaction, challengeId),
    );
    if (challengeUserId === undefined) throw invalidMfa();
    const principalContext =
      context.actor?.type === 'USER' && context.actor.id === challengeUserId
        ? context
        : this.principalContext(context, challengeUserId);
    const now = this.clock.now();
    const result = await this.unitOfWork.execute<ChallengeVerification>(
      principalContext,
      async (transaction) => {
        const challenge = await this.repository.findChallengeForUpdate(transaction, challengeId);
        if (!this.usableChallenge(challenge, now)) {
          return { kind: 'INVALID', attemptsExceeded: false };
        }
        if (
          challenge.purpose === 'STEP_UP' &&
          (context.actor?.type !== 'USER' ||
            context.actor.id !== challenge.userId ||
            context.sessionId === undefined ||
            context.sessionId !== challenge.sessionId)
        ) {
          return { kind: 'INVALID', attemptsExceeded: false };
        }
        const factors = await this.repository.listVerifiedTotpFactors(
          transaction,
          challenge.userId,
        );
        const factor = await this.consumeMatchingFactor(
          transaction,
          challenge.userId,
          factors,
          code,
          now,
        );
        if (factor === undefined) {
          const attempts = await this.repository.recordChallengeFailure(transaction, challenge.id);
          await this.appendAudit(transaction, principalContext, {
            now,
            action: 'authentication.mfa.verify',
            resourceType: 'mfa_challenge',
            resourceId: challenge.id,
            reasonCode: 'AUTH.MFA_INVALID',
            outcome: 'DENIED',
          });
          return {
            kind: 'INVALID',
            attemptsExceeded: attempts >= challenge.maximumAttempts,
          };
        }
        await this.repository.consumeChallenge(transaction, challenge.id, now);
        const tokenVersion = await this.repository.findActiveUserTokenVersion(
          transaction,
          challenge.userId,
        );
        if (tokenVersion === undefined) return { kind: 'INVALID', attemptsExceeded: false };

        if (challenge.purpose === 'STEP_UP') {
          const assuranceExpiresAt = addSeconds(now, this.policy.aal2LifetimeSeconds);
          if (
            challenge.sessionId === undefined ||
            !(await this.repository.upgradeSessionAssurance(
              transaction,
              challenge.userId,
              challenge.sessionId,
              now,
              assuranceExpiresAt,
            ))
          ) {
            return { kind: 'INVALID', attemptsExceeded: false };
          }
          await this.appendAudit(transaction, principalContext, {
            now,
            action: 'authentication.mfa.step-up',
            resourceType: 'auth_session',
            resourceId: challenge.sessionId,
            reasonCode: 'AUTH.STEP_UP_SUCCEEDED',
          });
          return {
            kind: 'STEP_UP',
            userId: challenge.userId,
            sessionId: challenge.sessionId,
            tokenVersion,
          };
        }

        if (challenge.purpose !== 'LOGIN' || challenge.clientType === undefined) {
          return { kind: 'INVALID', attemptsExceeded: false };
        }
        const sessionId = this.ids.generate();
        const familyId = this.ids.generate();
        const refreshTokenId = this.ids.generate();
        const rawRefreshToken = this.authenticationCryptography.generateRefreshToken();
        const absoluteExpiresAt = addSeconds(now, this.policy.sessionAbsoluteTtlSeconds);
        const refreshExpiresAt = earlier(
          addSeconds(now, this.policy.refreshTokenTtlSeconds),
          absoluteExpiresAt,
        );
        const assuranceExpiresAt = earlier(
          addSeconds(now, this.policy.aal2LifetimeSeconds),
          absoluteExpiresAt,
        );
        await this.authenticationRepository.createSessionAndRefreshToken(transaction, {
          sessionId,
          userId: challenge.userId,
          familyId,
          refreshTokenId,
          refreshTokenDigest: this.authenticationCryptography.digestRefreshToken(rawRefreshToken),
          refreshTokenExpiresAt: refreshExpiresAt,
          clientType: challenge.clientType,
          ...(challenge.deviceLabel === undefined ? {} : { deviceLabel: challenge.deviceLabel }),
          assurance: 'AAL2',
          assuranceExpiresAt,
          idleExpiresAt: earlier(
            addSeconds(now, this.policy.sessionIdleTtlSeconds),
            absoluteExpiresAt,
          ),
          absoluteExpiresAt,
          now,
        });
        await this.appendAudit(transaction, principalContext, {
          now,
          action: 'authentication.session.create',
          resourceType: 'auth_session',
          resourceId: sessionId,
          reasonCode: 'AUTH.ADMIN_LOGIN_SUCCEEDED',
          sessionId,
        });
        return {
          kind: 'LOGIN',
          userId: challenge.userId,
          sessionId,
          tokenVersion,
          clientType: challenge.clientType,
          rawRefreshToken,
          refreshExpiresAt,
        };
      },
    );

    if (result.kind === 'INVALID') throw invalidMfa(result.attemptsExceeded);
    const access = this.accessTokens.issue({
      userId: result.userId,
      sessionId: result.sessionId,
      assurance: 'AAL2',
      tokenVersion: result.tokenVersion,
      authenticationMethods: result.kind === 'LOGIN' ? ['password', 'totp'] : ['otp', 'totp'],
      now,
      tokenId: this.ids.generate(),
    });
    if (result.kind === 'STEP_UP') {
      return {
        kind: 'STEP_UP',
        userId: result.userId,
        sessionId: result.sessionId,
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        assurance: 'AAL2',
      };
    }
    return {
      kind: 'SESSION',
      userId: result.userId,
      clientType: result.clientType,
      tokens: {
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        refreshToken: result.rawRefreshToken,
        refreshTokenExpiresAt: result.refreshExpiresAt,
        sessionId: result.sessionId,
        assurance: 'AAL2',
      },
    };
  }

  async createTotpEnrollment(
    context: RequestContext,
    label: string,
  ): Promise<{
    readonly factorId: string;
    readonly sharedSecret: string;
    readonly provisioningUri: string;
    readonly expiresAt: Date;
  }> {
    const { userId } = this.requireAuthenticatedSession(context);
    const factorId = this.ids.generate();
    const enrollment = this.multiFactorCryptography.createTotpEnrollment({
      factorId,
      userId,
      accountLabel: userId,
    });
    const now = this.clock.now();
    const enrollmentExpiresAt = addSeconds(now, this.policy.mfaEnrollmentLifetimeSeconds);
    await this.unitOfWork.execute(context, async (transaction) => {
      if (await this.repository.hasVerifiedTotpFactor(transaction, userId)) {
        this.requireCurrentAal2(context, now);
      }
      await this.repository.createPendingTotpFactor(transaction, {
        id: factorId,
        userId,
        label,
        encryptedSecret: enrollment.encryptedSecret,
        keyVersion: enrollment.keyVersion,
        enrollmentExpiresAt,
        now,
      });
      await this.appendAudit(transaction, context, {
        now,
        action: 'authentication.mfa.enrollment.create',
        resourceType: 'mfa_factor',
        resourceId: factorId,
        reasonCode: 'AUTH.MFA_ENROLLMENT_STARTED',
      });
    });
    return {
      factorId,
      sharedSecret: enrollment.sharedSecret,
      provisioningUri: enrollment.provisioningUri,
      expiresAt: enrollmentExpiresAt,
    };
  }

  async verifyTotpEnrollment(
    context: RequestContext,
    factorId: string,
    code: string,
  ): Promise<{
    readonly userId: string;
    readonly sessionId: string;
    readonly accessToken: string;
    readonly accessTokenExpiresAt: Date;
    readonly assurance: 'AAL2';
  }> {
    const { userId, sessionId } = this.requireAuthenticatedSession(context);
    const now = this.clock.now();
    await this.unitOfWork.execute(context, async (transaction) => {
      const factor = await this.repository.findOwnedTotpFactorForUpdate(
        transaction,
        userId,
        factorId,
      );
      if (
        factor === undefined ||
        factor.verifiedAt !== undefined ||
        factor.revokedAt !== undefined ||
        factor.enrollmentExpiresAt === undefined ||
        factor.enrollmentExpiresAt.getTime() <= now.getTime()
      ) {
        throw invalidMfa();
      }
      const step = this.matchingStep(factor, code, now);
      const assuranceExpiresAt = addSeconds(now, this.policy.aal2LifetimeSeconds);
      if (
        step === undefined ||
        !(await this.repository.verifyTotpFactor(transaction, userId, factorId, step, now)) ||
        !(await this.repository.upgradeSessionAssurance(
          transaction,
          userId,
          sessionId,
          now,
          assuranceExpiresAt,
        ))
      ) {
        throw invalidMfa();
      }
      await this.appendAudit(transaction, context, {
        now,
        action: 'authentication.mfa.enrollment.verify',
        resourceType: 'mfa_factor',
        resourceId: factorId,
        reasonCode: 'AUTH.MFA_ENROLLMENT_VERIFIED',
      });
    });
    const access = this.accessTokens.issue({
      userId,
      sessionId,
      assurance: 'AAL2',
      tokenVersion: context.authentication?.tokenVersion ?? 0,
      authenticationMethods: ['otp', 'totp'],
      now,
      tokenId: this.ids.generate(),
    });
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      assurance: 'AAL2',
      userId,
      sessionId,
    };
  }

  private usableChallenge(
    challenge: MultiFactorChallengeRecord | undefined,
    now: Date,
  ): challenge is MultiFactorChallengeRecord {
    return (
      challenge !== undefined &&
      challenge.consumedAt === undefined &&
      challenge.expiresAt.getTime() > now.getTime() &&
      challenge.attempts < challenge.maximumAttempts
    );
  }

  private async consumeMatchingFactor(
    transaction: TransactionContext,
    userId: string,
    factors: readonly TotpFactorRecord[],
    code: string,
    now: Date,
  ): Promise<TotpFactorRecord | undefined> {
    for (const factor of factors) {
      const step = this.matchingStep(factor, code, now);
      if (
        step !== undefined &&
        (factor.lastUsedStep === undefined || step > factor.lastUsedStep) &&
        (await this.repository.consumeTotpStep(transaction, factor.id, step, now))
      ) {
        return factor;
      }
    }
    return undefined;
  }

  private matchingStep(factor: TotpFactorRecord, code: string, now: Date): number | undefined {
    return this.multiFactorCryptography.matchingTotpStep({
      factorId: factor.id,
      userId: factor.userId,
      encryptedSecret: factor.encryptedSecret,
      keyVersion: factor.keyVersion,
      code,
      now,
    });
  }

  private requireAuthenticatedSession(context: RequestContext): {
    readonly userId: string;
    readonly sessionId: string;
  } {
    if (context.actor?.type !== 'USER' || context.sessionId === undefined) {
      throw new ApplicationError({
        code: 'AUTH.AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.',
        status: 401,
      });
    }
    return { userId: context.actor.id, sessionId: context.sessionId };
  }

  private requireCurrentAal2(context: RequestContext, now: Date): void {
    if (
      context.authentication?.assurance !== 'AAL2' ||
      context.authentication.assuranceExpiresAt === undefined ||
      context.authentication.assuranceExpiresAt.getTime() <= now.getTime()
    ) {
      throw new ApplicationError({
        code: 'ACCESS.STEP_UP_REQUIRED',
        message: 'Recent multi-factor authentication is required.',
        status: 403,
      });
    }
  }

  private principalContext(context: RequestContext, userId: string): RequestContext {
    return new ResolvedRequestContext({
      requestId: context.requestId,
      correlationId: context.correlationId,
      ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
      source: context.source,
      actor: { type: 'USER', id: userId },
      ...(context.traceId === undefined ? {} : { traceId: context.traceId }),
      ...(context.spanId === undefined ? {} : { spanId: context.spanId }),
    });
  }

  private appendAudit(
    transaction: TransactionContext,
    context: RequestContext,
    input: {
      readonly now: Date;
      readonly action: string;
      readonly resourceType: string;
      readonly resourceId: string;
      readonly reasonCode: string;
      readonly outcome?: 'ALLOWED' | 'DENIED';
      readonly sessionId?: string;
    },
  ): Promise<void> {
    const actorId = context.actor?.type === 'USER' ? context.actor.id : undefined;
    const sessionId = input.sessionId ?? context.sessionId;
    return this.audit.append(transaction, {
      id: this.ids.generate(),
      occurredAt: input.now,
      actorType: actorId === undefined ? 'SYSTEM_POLICY' : 'USER',
      ...(actorId === undefined ? {} : { actorId }),
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(context.authentication === undefined
        ? {}
        : { authenticationAssurance: context.authentication.assurance }),
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      outcome: input.outcome ?? 'ALLOWED',
      reasonCode: input.reasonCode,
      correlationId: context.correlationId,
      source: context.source,
      retentionClass: 'SECURITY',
    });
  }
}
