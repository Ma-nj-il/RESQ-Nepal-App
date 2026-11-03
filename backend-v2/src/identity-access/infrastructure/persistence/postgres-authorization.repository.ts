import { Injectable } from '@nestjs/common';

import type { TransactionContext } from '../../../shared/application/persistence/unit-of-work.js';
import { entityManagerFor } from '../../../shared/infrastructure/persistence/typeorm-unit-of-work.js';
import type {
  AccessContextSummary,
  AuthorizationRepository,
  PrincipalProfile,
} from '../../application/ports/authorization-repository.js';
import type {
  AuthorityAuthorizationContext,
  TenantAuthorizationContext,
} from '../../domain/authorization.js';

@Injectable()
export class PostgresAuthorizationRepository implements AuthorizationRepository {
  async resolveTenantContext(
    transaction: TransactionContext,
    userId: string,
    tenantId: string,
    now: Date,
  ): Promise<TenantAuthorizationContext | undefined> {
    const rows: {
      assignment_id: string;
      tenant_id: string;
      profile_id: string;
      profile_version: number;
      scope_type: TenantAuthorizationContext['scopeType'];
      facility_ids: string[];
      permission_codes: string[];
      valid_until: Date;
    }[] = await entityManagerFor(transaction).query(
      'SELECT * FROM access_control.resolve_tenant_context($1, $2, $3)',
      [userId, tenantId, now],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    return {
      assignmentId: row.assignment_id,
      tenantId: row.tenant_id,
      profileId: row.profile_id,
      profileVersion: row.profile_version,
      scopeType: row.scope_type,
      facilityIds: Object.freeze([...row.facility_ids]),
      permissionCodes: new Set(row.permission_codes),
      validUntil: row.valid_until,
    };
  }

  async facilityBelongsToTenant(
    transaction: TransactionContext,
    userId: string,
    tenantId: string,
    facilityId: string,
    now: Date,
  ): Promise<boolean> {
    const rows: { allowed: boolean }[] = await entityManagerFor(transaction).query(
      'SELECT access_control.facility_allowed($1, $2, $3, $4) AS allowed',
      [userId, tenantId, facilityId, now],
    );
    return rows[0]?.allowed === true;
  }

  async resolveAuthorityContext(
    transaction: TransactionContext,
    userId: string,
    grantId: string,
    now: Date,
  ): Promise<AuthorityAuthorizationContext | undefined> {
    const rows: {
      grant_id: string;
      level: AuthorityAuthorizationContext['level'];
      permission_codes: string[];
      resource_classes: string[];
      geographic_unit_ids: string[];
      purpose: string;
      allows_pii: boolean;
      allows_document_content: boolean;
      allows_export: boolean;
      allows_intervention: boolean;
      required_assurance: AuthorityAuthorizationContext['requiredAssurance'];
      expires_at: Date;
    }[] = await entityManagerFor(transaction).query(
      'SELECT * FROM access_control.resolve_authority_context($1, $2, $3)',
      [userId, grantId, now],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    return {
      grantId: row.grant_id,
      level: row.level,
      permissionCodes: new Set(row.permission_codes),
      resourceClasses: new Set(row.resource_classes),
      geographicUnitIds: Object.freeze([...row.geographic_unit_ids]),
      purpose: row.purpose,
      allowsPii: row.allows_pii,
      allowsDocumentContent: row.allows_document_content,
      allowsExport: row.allows_export,
      allowsIntervention: row.allows_intervention,
      requiredAssurance: row.required_assurance,
      expiresAt: row.expires_at,
    };
  }

  async findPrincipalProfile(
    transaction: TransactionContext,
    userId: string,
  ): Promise<PrincipalProfile | undefined> {
    const rows: {
      id: string;
      status: PrincipalProfile['status'];
      display_name: string | null;
      phone_masked: string | null;
      locale: string;
      version: number;
      created_at: Date;
      updated_at: Date;
    }[] = await entityManagerFor(transaction).query(
      `SELECT u.id, u.status, p.display_name, p.phone_masked, p.locale, p.version,
              p.created_at, p.updated_at
         FROM identity.users u
         JOIN identity.user_profiles p ON p.user_id = u.id
        WHERE u.id = $1`,
      [userId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    return {
      id: row.id,
      status: row.status,
      ...(row.display_name === null ? {} : { displayName: row.display_name }),
      ...(row.phone_masked === null ? {} : { phoneMasked: row.phone_masked }),
      locale: row.locale,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listAccessContexts(
    transaction: TransactionContext,
    userId: string,
    now: Date,
  ): Promise<AccessContextSummary> {
    const manager = entityManagerFor(transaction);
    const tenantRows: {
      assignment_id: string;
      tenant_id: string;
      tenant_name: string;
      profile_id: string;
      profile_name: string;
      profile_version: number;
      scope_type: 'TENANT' | 'FACILITY_SET';
      facility_ids: string[];
      valid_until: Date;
    }[] = await manager.query('SELECT * FROM access_control.list_tenant_contexts($1, $2)', [
      userId,
      now,
    ]);
    const authorityRows: {
      grant_id: string;
      level: 'PROVINCE' | 'PLATFORM';
      purpose: string;
      expires_at: Date;
    }[] = await manager.query('SELECT * FROM access_control.list_authority_contexts($1, $2)', [
      userId,
      now,
    ]);
    return {
      tenantAssignments: tenantRows.map((row) => ({
        assignmentId: row.assignment_id,
        tenantId: row.tenant_id,
        tenantName: row.tenant_name,
        profileId: row.profile_id,
        profileName: row.profile_name,
        profileVersion: row.profile_version,
        scopeType: row.scope_type,
        facilityIds: Object.freeze([...row.facility_ids]),
        validUntil: row.valid_until,
      })),
      authorityGrants: authorityRows.map((row) => ({
        grantId: row.grant_id,
        level: row.level,
        purpose: row.purpose,
        expiresAt: row.expires_at,
      })),
    };
  }
}
