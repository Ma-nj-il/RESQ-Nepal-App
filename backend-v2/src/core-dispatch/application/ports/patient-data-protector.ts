import type { JsonValue } from '../../../shared/application/idempotency/idempotency.js';

export interface ProtectedPatientData {
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
  readonly tag: Buffer;
  readonly keyVersion: string;
}

export interface PatientDataProtector {
  protect(payload: Readonly<Record<string, JsonValue>>): Promise<ProtectedPatientData>;
}

export const PATIENT_DATA_PROTECTOR = Symbol('PATIENT_DATA_PROTECTOR');
