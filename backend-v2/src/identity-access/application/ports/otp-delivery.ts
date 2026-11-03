export interface OtpDelivery {
  send(input: {
    readonly challengeId: string;
    readonly normalizedPhone: string;
    readonly otp: string;
    readonly expiresAt: Date;
  }): Promise<void>;
}

export const OTP_DELIVERY = Symbol('OTP_DELIVERY');
