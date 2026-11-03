export interface AuthenticationRateLimiter {
  consume(input: {
    readonly bucket: string;
    readonly discriminator: string;
    readonly maximumAttempts: number;
    readonly windowSeconds: number;
  }): Promise<void>;
}

export const AUTHENTICATION_RATE_LIMITER = Symbol('AUTHENTICATION_RATE_LIMITER');
