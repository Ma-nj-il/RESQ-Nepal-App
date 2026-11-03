import type { RequestContext } from '../../shared/application/context/request-context.js';
import { RequestContext as ResolvedRequestContext } from '../../shared/application/context/request-context.js';
import { ApplicationError } from '../../shared/application/errors/application-error.js';
import type { UnitOfWork } from '../../shared/application/persistence/unit-of-work.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { AccessTokenIssuer } from './ports/authentication-cryptography.js';
import type { AuthenticationRepository } from './ports/authentication-repository.js';
import type {
  AccessContextSummary,
  AuthorizationRepository,
  PrincipalProfile,
} from './ports/authorization-repository.js';

export type RouteContextClass = 'SELF' | 'TENANT' | 'AUTHORITY';

export interface RouteAuthorizationRequirement {
  readonly context: RouteContextClass;
  readonly permission?: string;
  readonly minimumAssurance?: 'AAL1' | 'AAL2';
  readonly resourceClass?: string;
  readonly requiresPii?: boolean;
  readonly requiresDocumentContent?: boolean;
  readonly requiresExport?: boolean;
  readonly requiresIntervention?: boolean;
}

export interface RequestSelectors {
  readonly tenantId?: string;
  readonly facilityId?: string;
  readonly authorityGrantId?: string;
}

function authenticationError(code: string): ApplicationError {
  return new ApplicationError({
    code,
    message: 'The authentication session is no longer valid.',
    status: 401,
  });
}

function accessDenied(): ApplicationError {
  return new ApplicationError({
    code: 'ACCESS.PERMISSION_DENIED',
    message: 'This action is not permitted.',
    status: 403,
  });
}

function stepUpRequired(): ApplicationError {
  return new ApplicationError({
    code: 'ACCESS.STEP_UP_REQUIRED',
    message: 'Recent multi-factor authentication is required.',
    status: 403,
  });
}

export class AuthorizationService {
  constructor(
    private readonly authenticationRepository: AuthenticationRepository,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly accessTokens: AccessTokenIssuer,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async authorize(
    baseContext: RequestContext,
    token: string,
    selectors: RequestSelectors,
    requirement: RouteAuthorizationRequirement,
  ): Promise<RequestContext> {
    const now = this.clock.now();
    const claims = this.accessTokens.verify(token, now);
    const provisional = new ResolvedRequestContext({
      requestId: baseContext.requestId,
      correlationId: baseContext.correlationId,
      ...(baseContext.causationId === undefined ? {} : { causationId: baseContext.causationId }),
      source: baseContext.source,
      actor: { type: 'USER', id: claims.subject },
      sessionId: claims.sessionId,
      authentication: {
        assurance: claims.assurance,
        tokenVersion: claims.tokenVersion,
      },
      ...(baseContext.traceId === undefined ? {} : { traceId: baseContext.traceId }),
      ...(baseContext.spanId === undefined ? {} : { spanId: baseContext.spanId }),
    });

    return this.unitOfWork.execute(provisional, async (transaction) => {
      const session = await this.authenticationRepository.findSessionAuthorizationState(
        transaction,
        claims.subject,
        claims.sessionId,
      );
      if (session === undefined) throw authenticationError('AUTH.SESSION_REVOKED');
      if (session.userStatus !== 'ACTIVE') throw authenticationError('AUTH.ACCOUNT_INACTIVE');
      if (session.revokedAt !== undefined || session.riskBlockedAt !== undefined) {
        throw authenticationError('AUTH.SESSION_REVOKED');
      }
      if (
        session.idleExpiresAt.getTime() <= now.getTime() ||
        session.absoluteExpiresAt.getTime() <= now.getTime()
      ) {
        throw authenticationError('AUTH.SESSION_EXPIRED');
      }
      const sessionAssurance =
        session.assurance === 'AAL2' &&
        session.assuranceExpiresAt !== undefined &&
        session.assuranceExpiresAt.getTime() > now.getTime()
          ? 'AAL2'
          : 'AAL1';
      if (
        session.userTokenVersion !== claims.tokenVersion ||
        sessionAssurance !== claims.assurance
      ) {
        throw authenticationError('AUTH.ACCESS_TOKEN_STALE');
      }
      if (requirement.minimumAssurance === 'AAL2' && sessionAssurance !== 'AAL2') {
        throw stepUpRequired();
      }

      const authenticated = new ResolvedRequestContext({
        ...this.copyBase(provisional),
        authentication: {
          assurance: sessionAssurance,
          tokenVersion: claims.tokenVersion,
          ...(sessionAssurance === 'AAL2' && session.assuranceExpiresAt !== undefined
            ? { assuranceExpiresAt: session.assuranceExpiresAt }
            : {}),
        },
      });

      if (requirement.context === 'SELF') {
        if (
          selectors.tenantId !== undefined ||
          selectors.facilityId !== undefined ||
          selectors.authorityGrantId !== undefined
        ) {
          throw accessDenied();
        }
        return authenticated;
      }

      if (requirement.context === 'TENANT') {
        const tenantId = selectors.tenantId;
        if (tenantId === undefined || selectors.authorityGrantId !== undefined)
          throw accessDenied();
        const tenantContext = await this.authorizationRepository.resolveTenantContext(
          transaction,
          claims.subject,
          tenantId,
          now,
        );
        if (tenantContext === undefined) throw accessDenied();
        if (
          requirement.permission !== undefined &&
          !tenantContext.permissionCodes.has(requirement.permission)
        ) {
          throw accessDenied();
        }
        let facilityIds = tenantContext.facilityIds;
        if (selectors.facilityId !== undefined) {
          const allowed =
            tenantContext.scopeType === 'FACILITY_SET'
              ? tenantContext.facilityIds.includes(selectors.facilityId)
              : await this.authorizationRepository.facilityBelongsToTenant(
                  transaction,
                  claims.subject,
                  tenantId,
                  selectors.facilityId,
                  now,
                );
          if (!allowed) throw accessDenied();
          facilityIds = [selectors.facilityId];
        }
        return new ResolvedRequestContext({
          ...this.copyBase(authenticated),
          scope: {
            tenantId,
            facilityIds,
            accessScopeType: tenantContext.scopeType,
            delegationExpiresAt: tenantContext.validUntil,
          },
          authentication: {
            assurance: sessionAssurance,
            tokenVersion: claims.tokenVersion,
            ...(sessionAssurance === 'AAL2' && session.assuranceExpiresAt !== undefined
              ? { assuranceExpiresAt: session.assuranceExpiresAt }
              : {}),
            profileVersion: tenantContext.profileVersion,
            permissionCodes: [...tenantContext.permissionCodes],
          },
        });
      }

      const grantId = selectors.authorityGrantId;
      if (
        grantId === undefined ||
        selectors.tenantId !== undefined ||
        selectors.facilityId !== undefined
      ) {
        throw accessDenied();
      }
      const authority = await this.authorizationRepository.resolveAuthorityContext(
        transaction,
        claims.subject,
        grantId,
        now,
      );
      if (authority === undefined) throw accessDenied();
      if (
        requirement.permission !== undefined &&
        !authority.permissionCodes.has(requirement.permission)
      ) {
        throw accessDenied();
      }
      if (authority.requiredAssurance === 'AAL2' && claims.assurance !== 'AAL2') {
        throw stepUpRequired();
      }
      if (
        (requirement.resourceClass !== undefined &&
          !authority.resourceClasses.has(requirement.resourceClass)) ||
        (requirement.requiresPii === true && !authority.allowsPii) ||
        (requirement.requiresDocumentContent === true && !authority.allowsDocumentContent) ||
        (requirement.requiresExport === true && !authority.allowsExport) ||
        (requirement.requiresIntervention === true && !authority.allowsIntervention)
      ) {
        throw accessDenied();
      }
      return new ResolvedRequestContext({
        ...this.copyBase(authenticated),
        scope: {
          authorityGrantId: grantId,
          facilityIds: [],
          delegationExpiresAt: authority.expiresAt,
          authority: {
            level: authority.level,
            resourceClasses: [...authority.resourceClasses],
            geographicUnitIds: authority.geographicUnitIds,
            allowsPii: authority.allowsPii,
            allowsDocumentContent: authority.allowsDocumentContent,
            allowsExport: authority.allowsExport,
            allowsIntervention: authority.allowsIntervention,
            expiresAt: authority.expiresAt,
          },
        },
        authentication: {
          assurance: sessionAssurance,
          tokenVersion: claims.tokenVersion,
          ...(sessionAssurance === 'AAL2' && session.assuranceExpiresAt !== undefined
            ? { assuranceExpiresAt: session.assuranceExpiresAt }
            : {}),
          permissionCodes: [...authority.permissionCodes],
        },
      });
    });
  }

  async profile(context: RequestContext): Promise<PrincipalProfile> {
    const userId = this.requireUserId(context);
    const profile = await this.unitOfWork.execute(context, (transaction) =>
      this.authorizationRepository.findPrincipalProfile(transaction, userId),
    );
    if (profile === undefined) throw authenticationError('AUTH.ACCOUNT_INACTIVE');
    return profile;
  }

  async accessContexts(context: RequestContext): Promise<AccessContextSummary> {
    const userId = this.requireUserId(context);
    return this.unitOfWork.execute(context, (transaction) =>
      this.authorizationRepository.listAccessContexts(transaction, userId, this.clock.now()),
    );
  }

  private requireUserId(context: RequestContext): string {
    if (context.actor?.type !== 'USER') throw authenticationError('AUTH.AUTHENTICATION_REQUIRED');
    return context.actor.id;
  }

  private copyBase(
    context: RequestContext,
  ): ConstructorParameters<typeof ResolvedRequestContext>[0] {
    return {
      requestId: context.requestId,
      correlationId: context.correlationId,
      ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
      source: context.source,
      ...(context.actor === undefined ? {} : { actor: context.actor }),
      ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
      ...(context.traceId === undefined ? {} : { traceId: context.traceId }),
      ...(context.spanId === undefined ? {} : { spanId: context.spanId }),
    };
  }
}
