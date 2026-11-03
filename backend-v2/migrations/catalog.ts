import { createHash } from 'node:crypto';

import type { MigrationInterface } from 'typeorm';

import {
  CreateGovernanceControl1793664000000,
  GOVERNANCE_CONTROL_SQL,
} from './1793664000000-create-governance-control.js';
import {
  CreateGovernanceDelivery1793664000001,
  GOVERNANCE_DELIVERY_SQL,
} from './1793664000001-create-governance-delivery.js';
import {
  CreateIdentityAccess1793664000002,
  IDENTITY_ACCESS_SQL,
} from './1793664000002-create-identity-access.js';
import {
  CreateProviderOperations1793664000003,
  PROVIDER_OPERATIONS_SQL,
} from './1793664000003-create-provider-operations.js';

type MigrationConstructor = new () => MigrationInterface;

export const MIGRATIONS: readonly MigrationConstructor[] = Object.freeze([
  CreateGovernanceControl1793664000000,
  CreateGovernanceDelivery1793664000001,
  CreateIdentityAccess1793664000002,
  CreateProviderOperations1793664000003,
]);

function checksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export const MIGRATION_CHECKSUMS: Readonly<Record<string, string>> = Object.freeze({
  CreateGovernanceControl1793664000000: checksum(GOVERNANCE_CONTROL_SQL),
  CreateGovernanceDelivery1793664000001: checksum(GOVERNANCE_DELIVERY_SQL),
  CreateIdentityAccess1793664000002: checksum(IDENTITY_ACCESS_SQL),
  CreateProviderOperations1793664000003: checksum(PROVIDER_OPERATIONS_SQL),
});
