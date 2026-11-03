import { Inject, Injectable } from '@nestjs/common';

import { ApplicationError } from '../../../shared/application/errors/application-error.js';
import {
  APP_CONFIG,
  type ApplicationConfig,
} from '../../../shared/infrastructure/config/application-config.js';
import type { OtpDelivery } from '../../application/ports/otp-delivery.js';

/**
 * Local fixed-code delivery deliberately emits no log or response containing an OTP. Production
 * remains fail-closed until an approved messaging adapter replaces this provider.
 */
@Injectable()
export class ConfiguredOtpDelivery implements OtpDelivery {
  constructor(@Inject(APP_CONFIG) private readonly config: ApplicationConfig) {}

  send(_input: {
    readonly challengeId: string;
    readonly normalizedPhone: string;
    readonly otp: string;
    readonly expiresAt: Date;
  }): Promise<void> {
    if (
      this.config.environment !== 'production' &&
      this.config.authentication.fixedDevelopmentOtp !== undefined
    ) {
      return Promise.resolve();
    }
    return Promise.reject(
      new ApplicationError({
        code: 'MESSAGING.OTP_DELIVERY_UNAVAILABLE',
        message: 'OTP delivery is temporarily unavailable.',
        status: 503,
        retryable: true,
      }),
    );
  }
}
