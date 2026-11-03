import { Injectable } from '@nestjs/common';

import type { SafetyAlertDelivery } from '../../application/ports/safety-alert-delivery.js';
import { ApplicationError } from '../../../shared/application/errors/application-error.js';

@Injectable()
export class UnavailableSafetyAlertDelivery implements SafetyAlertDelivery {
  deliver(): Promise<void> {
    return Promise.reject(
      new ApplicationError({
        code: 'SAFETY.ALERT_PROVIDER_UNAVAILABLE',
        message: 'No approved safety alert delivery provider is configured.',
        status: 503,
        retryable: true,
      }),
    );
  }
}
