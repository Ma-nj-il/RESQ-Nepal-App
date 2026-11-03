export interface AuthenticationPolicy {
  readonly otpLifetimeSeconds: number;
  readonly otpMaximumAttempts: number;
  readonly mfaChallengeLifetimeSeconds: number;
  readonly mfaEnrollmentLifetimeSeconds: number;
  readonly mfaMaximumAttempts: number;
  readonly aal2LifetimeSeconds: number;
  readonly refreshTokenTtlSeconds: number;
  readonly sessionIdleTtlSeconds: number;
  readonly sessionAbsoluteTtlSeconds: number;
  readonly fixedDevelopmentOtp?: string;
}

export const AUTHENTICATION_POLICY = Symbol('AUTHENTICATION_POLICY');
