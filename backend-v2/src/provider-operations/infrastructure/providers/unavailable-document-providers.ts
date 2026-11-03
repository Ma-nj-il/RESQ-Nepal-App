import { Injectable } from '@nestjs/common';

import { ApplicationError } from '../../../shared/application/errors/application-error.js';
import type { MalwareScanner, MalwareScanResult } from '../../application/ports/malware-scanner.js';
import type {
  ObjectStorage,
  PrivateObjectMetadata,
} from '../../application/ports/object-storage.js';

function unavailable(code: string): ApplicationError {
  return new ApplicationError({
    code,
    message: 'The required document provider is not configured.',
    status: 503,
    retryable: true,
  });
}

@Injectable()
export class UnavailableObjectStorage implements ObjectStorage {
  createUploadGrant(): Promise<never> {
    return Promise.reject(unavailable('DOCUMENT.STORAGE_UNAVAILABLE'));
  }

  readMetadata(): Promise<PrivateObjectMetadata | undefined> {
    return Promise.reject(unavailable('DOCUMENT.STORAGE_UNAVAILABLE'));
  }

  createDownloadGrant(): Promise<never> {
    return Promise.reject(unavailable('DOCUMENT.STORAGE_UNAVAILABLE'));
  }
}

@Injectable()
export class UnavailableMalwareScanner implements MalwareScanner {
  scanImmutableObject(): Promise<MalwareScanResult> {
    return Promise.reject(unavailable('DOCUMENT.SCANNER_UNAVAILABLE'));
  }
}
