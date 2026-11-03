import type { AccessAdministrationService } from './application/access-administration.service.js';
import type { AuthenticationService } from './application/authentication.service.js';
import type { AuthorizationService } from './application/authorization.service.js';
import type { MultiFactorAuthenticationService } from './application/multi-factor-authentication.service.js';

export const ACCESS_ADMINISTRATION_SERVICE = Symbol('ACCESS_ADMINISTRATION_SERVICE');
export const AUTHENTICATION_SERVICE = Symbol('AUTHENTICATION_SERVICE');
export const AUTHORIZATION_SERVICE = Symbol('AUTHORIZATION_SERVICE');
export const MULTI_FACTOR_AUTHENTICATION_SERVICE = Symbol('MULTI_FACTOR_AUTHENTICATION_SERVICE');

export type AccessAdministrationServiceToken = AccessAdministrationService;
export type AuthenticationServiceToken = AuthenticationService;
export type AuthorizationServiceToken = AuthorizationService;
export type MultiFactorAuthenticationServiceToken = MultiFactorAuthenticationService;
