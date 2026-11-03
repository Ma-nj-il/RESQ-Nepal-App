import type { DocumentService } from './application/document.service.js';
import type { ProviderRegistryService } from './application/provider-registry.service.js';
import type { WorkforceFleetService } from './application/workforce-fleet.service.js';

export const DOCUMENT_SERVICE = Symbol('DOCUMENT_SERVICE');
export const PROVIDER_REGISTRY_SERVICE = Symbol('PROVIDER_REGISTRY_SERVICE');
export const WORKFORCE_FLEET_SERVICE = Symbol('WORKFORCE_FLEET_SERVICE');

export type DocumentServiceToken = DocumentService;
export type ProviderRegistryServiceToken = ProviderRegistryService;
export type WorkforceFleetServiceToken = WorkforceFleetService;
