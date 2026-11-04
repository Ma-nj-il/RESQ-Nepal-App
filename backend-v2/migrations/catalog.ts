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
import {
  CORE_DISPATCH_SQL,
  CreateCoreDispatch1793664000004,
} from './1793664000004-create-core-dispatch.js';
import {
  PRODUCT_SERVICES_SQL,
  CreateProductServices1793664000005,
} from './1793664000005-create-product-services.js';
import {
  DOCUMENT_WORKERS_SQL,
  BindDocumentWorkers1793664000006,
} from './1793664000006-bind-document-workers.js';
import {
  PreserveSessionAuthenticationMethods1793664000007,
  SESSION_AUTHENTICATION_METHODS_SQL,
} from './1793664000007-preserve-session-authentication-methods.js';

type MigrationConstructor = new () => MigrationInterface;

export const MIGRATIONS: readonly MigrationConstructor[] = Object.freeze([
  CreateGovernanceControl1793664000000,
  CreateGovernanceDelivery1793664000001,
  CreateIdentityAccess1793664000002,
  CreateProviderOperations1793664000003,
  CreateCoreDispatch1793664000004,
  CreateProductServices1793664000005,
  BindDocumentWorkers1793664000006,
  PreserveSessionAuthenticationMethods1793664000007,
]);

function checksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export const MIGRATION_CHECKSUMS: Readonly<Record<string, string>> = Object.freeze({
  CreateGovernanceControl1793664000000: checksum(GOVERNANCE_CONTROL_SQL),
  CreateGovernanceDelivery1793664000001: checksum(GOVERNANCE_DELIVERY_SQL),
  CreateIdentityAccess1793664000002: checksum(IDENTITY_ACCESS_SQL),
  CreateProviderOperations1793664000003: checksum(PROVIDER_OPERATIONS_SQL),
  CreateCoreDispatch1793664000004: checksum(CORE_DISPATCH_SQL),
  CreateProductServices1793664000005: checksum(PRODUCT_SERVICES_SQL),
  BindDocumentWorkers1793664000006: checksum(DOCUMENT_WORKERS_SQL),
  PreserveSessionAuthenticationMethods1793664000007: checksum(SESSION_AUTHENTICATION_METHODS_SQL),
});
