import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { ApplicationError } from '../../../shared/application/errors/application-error.js';
import {
  APP_CONFIG,
  type ApplicationConfig,
} from '../../../shared/infrastructure/config/application-config.js';
import { RequestContextStorage } from '../../../shared/infrastructure/context/request-context.storage.js';
import { successResponse } from '../../../shared/presentation/http/success-response.js';
import {
  AUTHENTICATION_RATE_LIMITER,
  type AuthenticationRateLimiter,
} from '../../application/ports/authentication-rate-limiter.js';
import {
  ACCESS_TOKEN_ISSUER,
  type AccessTokenIssuer,
} from '../../application/ports/authentication-cryptography.js';
import {
  AUTHENTICATION_SERVICE,
  AUTHORIZATION_SERVICE,
  MULTI_FACTOR_AUTHENTICATION_SERVICE,
  type AuthenticationServiceToken,
  type AuthorizationServiceToken,
  type MultiFactorAuthenticationServiceToken,
} from '../../identity-access.tokens.js';
import { RequireAuthorization } from './route-authorization.decorator.js';
import {
  MfaVerificationDto,
  PasswordSessionDto,
  RefreshTokenDto,
  RequestOtpDto,
  TotpEnrollmentDto,
  VerifyOtpDto,
} from './authentication.dto.js';

const REFRESH_COOKIE = 'resq_refresh';

function cookies(header: string | undefined): Readonly<Record<string, string>> {
  if (header === undefined) return {};
  return Object.fromEntries(
    header.split(';').flatMap((part) => {
      const separator = part.indexOf('=');
      if (separator <= 0) return [];
      const key = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      try {
        return [[key, decodeURIComponent(value)]];
      } catch {
        return [];
      }
    }),
  );
}

@Controller()
export class AuthenticationController {
  constructor(
    @Inject(AUTHENTICATION_SERVICE) private readonly authentication: AuthenticationServiceToken,
    @Inject(MULTI_FACTOR_AUTHENTICATION_SERVICE)
    private readonly multiFactor: MultiFactorAuthenticationServiceToken,
    @Inject(AUTHORIZATION_SERVICE) private readonly authorization: AuthorizationServiceToken,
    @Inject(AUTHENTICATION_RATE_LIMITER)
    private readonly rateLimiter: AuthenticationRateLimiter,
    @Inject(ACCESS_TOKEN_ISSUER) private readonly accessTokens: AccessTokenIssuer,
    @Inject(RequestContextStorage) private readonly contexts: RequestContextStorage,
    @Inject(APP_CONFIG) private readonly config: ApplicationConfig,
  ) {}

  @Post('/api/v1/auth/otp-challenges')
  @HttpCode(202)
  async requestOtp(@Body() body: RequestOtpDto, @Req() request: Request): Promise<unknown> {
    await this.rateLimit('otp-request-ip', this.clientAddress(request), 20, 600);
    await this.rateLimit('otp-request-phone', body.phoneNumber.replace(/[^\d+]/g, ''), 5, 600);
    const challenge = await this.authentication.requestOtp(this.contexts.require(), body);
    return successResponse(this.contexts, {
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt.toISOString(),
      deliveryState: 'ACCEPTED',
    });
  }

  @Post('/api/v1/auth/otp-verifications')
  @HttpCode(201)
  async verifyOtp(
    @Body() body: VerifyOtpDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    await this.rateLimit('otp-verify-ip', this.clientAddress(request), 30, 600);
    await this.rateLimit('otp-verify-challenge', body.challengeId, 8, 600);
    const result = await this.authentication.verifyOtp(this.contexts.require(), body);
    response.setHeader('Cache-Control', 'no-store');
    if (body.clientType === 'BROWSER') {
      this.setRefreshCookie(
        response,
        result.tokens.refreshToken,
        result.tokens.refreshTokenExpiresAt,
      );
    }
    return successResponse(this.contexts, {
      userId: result.userId,
      sessionId: result.tokens.sessionId,
      assurance: result.tokens.assurance,
      accessToken: result.tokens.accessToken,
      accessTokenExpiresAt: result.tokens.accessTokenExpiresAt.toISOString(),
      ...(body.clientType === 'MOBILE'
        ? {
            refreshToken: result.tokens.refreshToken,
            refreshTokenExpiresAt: result.tokens.refreshTokenExpiresAt.toISOString(),
          }
        : {}),
    });
  }

  @Post('/api/v1/auth/password-sessions')
  @HttpCode(202)
  async passwordSession(
    @Body() body: PasswordSessionDto,
    @Req() request: Request,
  ): Promise<unknown> {
    await this.rateLimit('password-login-ip', this.clientAddress(request), 20, 900);
    await this.rateLimit('password-login-identifier', body.identifier.trim().toLowerCase(), 8, 900);
    const challenge = await this.multiFactor.createPasswordChallenge(this.contexts.require(), body);
    return successResponse(this.contexts, {
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt.toISOString(),
      nextStep: 'TOTP',
    });
  }

  @Post('/api/v1/auth/mfa-challenges')
  @RequireAuthorization({ context: 'SELF' })
  @HttpCode(201)
  async createMfaChallenge(@Req() request: Request): Promise<unknown> {
    const context = this.contexts.require();
    await this.rateLimit(
      'mfa-step-up-user',
      context.actor?.type === 'USER' ? context.actor.id : this.clientAddress(request),
      10,
      600,
    );
    const challenge = await this.multiFactor.createStepUpChallenge(context);
    return successResponse(this.contexts, {
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt.toISOString(),
      nextStep: 'TOTP',
    });
  }

  @Post('/api/v1/auth/mfa-challenges/:challengeId/verifications')
  @HttpCode(200)
  async verifyMfaChallenge(
    @Param('challengeId') challengeId: string,
    @Body() body: MfaVerificationDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    await this.rateLimit('mfa-verify-ip', this.clientAddress(request), 30, 600);
    await this.rateLimit('mfa-verify-challenge', challengeId, 8, 600);
    await this.resolveOptionalAuthentication(request);
    const result = await this.multiFactor.verifyChallenge(
      this.contexts.require(),
      challengeId,
      body.code,
    );
    response.setHeader('Cache-Control', 'no-store');
    if (result.kind === 'STEP_UP') {
      return successResponse(this.contexts, {
        userId: result.userId,
        sessionId: result.sessionId,
        assurance: result.assurance,
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
      });
    }
    if (result.clientType === 'BROWSER') {
      this.setRefreshCookie(
        response,
        result.tokens.refreshToken,
        result.tokens.refreshTokenExpiresAt,
      );
    }
    return successResponse(this.contexts, {
      userId: result.userId,
      sessionId: result.tokens.sessionId,
      assurance: result.tokens.assurance,
      accessToken: result.tokens.accessToken,
      accessTokenExpiresAt: result.tokens.accessTokenExpiresAt.toISOString(),
      ...(result.clientType === 'MOBILE'
        ? {
            refreshToken: result.tokens.refreshToken,
            refreshTokenExpiresAt: result.tokens.refreshTokenExpiresAt.toISOString(),
          }
        : {}),
    });
  }

  @Post('/api/v1/me/mfa/totp-enrollments')
  @RequireAuthorization({ context: 'SELF' })
  @HttpCode(201)
  async createTotpEnrollment(
    @Body() body: TotpEnrollmentDto,
    @Req() request: Request,
  ): Promise<unknown> {
    const context = this.contexts.require();
    await this.rateLimit(
      'mfa-enrollment-user',
      context.actor?.type === 'USER' ? context.actor.id : this.clientAddress(request),
      5,
      3600,
    );
    const enrollment = await this.multiFactor.createTotpEnrollment(context, body.label);
    return successResponse(this.contexts, enrollment);
  }

  @Post('/api/v1/me/mfa/totp-enrollments/:factorId/verification')
  @RequireAuthorization({ context: 'SELF' })
  @HttpCode(200)
  async verifyTotpEnrollment(
    @Param('factorId') factorId: string,
    @Body() body: MfaVerificationDto,
    @Req() request: Request,
  ): Promise<unknown> {
    const context = this.contexts.require();
    await this.rateLimit(
      'mfa-enrollment-verify',
      `${context.actor?.type === 'USER' ? context.actor.id : this.clientAddress(request)}:${factorId}`,
      8,
      600,
    );
    const result = await this.multiFactor.verifyTotpEnrollment(context, factorId, body.code);
    return successResponse(this.contexts, {
      assurance: result.assurance,
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
    });
  }

  @Post('/api/v1/auth/tokens/refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: RefreshTokenDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const cookieToken = cookies(request.header('cookie'))[REFRESH_COOKIE];
    const usingCookie = body.refreshToken === undefined && cookieToken !== undefined;
    if (usingCookie) this.verifyBrowserOrigin(request);
    const refreshToken = body.refreshToken ?? cookieToken;
    if (refreshToken === undefined) {
      throw new ApplicationError({
        code: 'AUTH.REFRESH_TOKEN_INVALID',
        message: 'The refresh session is no longer valid.',
        status: 401,
      });
    }
    await this.rateLimit('refresh-ip', this.clientAddress(request), 120, 900);
    await this.rateLimit('refresh-token', refreshToken, 20, 900);
    const result = await this.authentication.refresh(this.contexts.require(), refreshToken);
    response.setHeader('Cache-Control', 'no-store');
    if (usingCookie) {
      this.setRefreshCookie(
        response,
        result.tokens.refreshToken,
        result.tokens.refreshTokenExpiresAt,
      );
    }
    return successResponse(this.contexts, {
      userId: result.userId,
      sessionId: result.tokens.sessionId,
      assurance: result.tokens.assurance,
      accessToken: result.tokens.accessToken,
      accessTokenExpiresAt: result.tokens.accessTokenExpiresAt.toISOString(),
      ...(usingCookie
        ? {}
        : {
            refreshToken: result.tokens.refreshToken,
            refreshTokenExpiresAt: result.tokens.refreshTokenExpiresAt.toISOString(),
          }),
    });
  }

  @Delete('/api/v1/auth/sessions/current')
  @RequireAuthorization({ context: 'SELF' })
  @HttpCode(204)
  async logout(@Res({ passthrough: true }) response: Response): Promise<void> {
    await this.authentication.revokeCurrentSession(this.contexts.require());
    response.clearCookie(REFRESH_COOKIE, {
      path: '/api/v1/auth',
      httpOnly: true,
      sameSite: 'strict',
    });
  }

  @Get('/.well-known/jwks.json')
  jwks(@Res({ passthrough: true }) response: Response): unknown {
    response.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    return this.accessTokens.jwks();
  }

  private setRefreshCookie(response: Response, token: string, expiresAt: Date): void {
    response.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.config.environment === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
      expires: expiresAt,
    });
  }

  private verifyBrowserOrigin(request: Request): void {
    const origin = request.header('origin');
    if (origin === undefined || !this.config.http.corsOrigins.includes(origin)) {
      throw new ApplicationError({
        code: 'AUTH.ORIGIN_REJECTED',
        message: 'The browser request origin is not allowed.',
        status: 403,
      });
    }
  }

  private clientAddress(request: Request): string {
    return request.socket.remoteAddress ?? request.ip ?? 'unknown';
  }

  private async resolveOptionalAuthentication(request: Request): Promise<void> {
    const value = request.header('authorization');
    if (value === undefined) return;
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(value);
    if (match?.[1] === undefined) {
      throw new ApplicationError({
        code: 'AUTH.AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.',
        status: 401,
      });
    }
    const resolved = await this.authorization.authorize(
      this.contexts.require(),
      match[1],
      {},
      { context: 'SELF' },
    );
    this.contexts.replace(resolved);
  }

  private rateLimit(
    bucket: string,
    discriminator: string,
    maximumAttempts: number,
    windowSeconds: number,
  ): Promise<void> {
    return this.rateLimiter.consume({
      bucket,
      discriminator,
      maximumAttempts,
      windowSeconds,
    });
  }
}
