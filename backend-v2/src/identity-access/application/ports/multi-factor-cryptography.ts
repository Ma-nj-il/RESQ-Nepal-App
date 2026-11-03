export interface PasswordVerifier {
  verify(encodedHash: string | undefined, password: string): Promise<boolean>;
}

export const PASSWORD_VERIFIER = Symbol('PASSWORD_VERIFIER');

export interface TotpEnrollmentSecret {
  readonly encryptedSecret: Uint8Array;
  readonly keyVersion: string;
  readonly sharedSecret: string;
  readonly provisioningUri: string;
}

export interface MultiFactorCryptography {
  createTotpEnrollment(input: {
    readonly factorId: string;
    readonly userId: string;
    readonly accountLabel: string;
  }): TotpEnrollmentSecret;
  matchingTotpStep(input: {
    readonly factorId: string;
    readonly userId: string;
    readonly encryptedSecret: Uint8Array;
    readonly keyVersion: string;
    readonly code: string;
    readonly now: Date;
  }): number | undefined;
}

export const MULTI_FACTOR_CRYPTOGRAPHY = Symbol('MULTI_FACTOR_CRYPTOGRAPHY');
