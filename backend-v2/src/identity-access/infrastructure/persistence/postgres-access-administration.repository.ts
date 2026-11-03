import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { ApplicationError } from '../../../shared/application/errors/application-error.js';
import type { TransactionContext } from '../../../shared/application/persistence/unit-of-work.js';
import { entityManagerFor } from '../../../shared/infrastructure/persistence/typeorm-unit-of-work.js';
import type {
  AccessAdministrationRepository,
  AccessAssignmentRecord,
  AuthorityGrantRecord,
  PermissionCatalogItem,
  RoleProfileRecord,
  RoleRecord,
} from '../../application/ports/access-administration.repository.js';

interface RoleRow {
  readonly id: string;
  readonly owner_type: RoleRecord['ownerType'];
  readonly tenant_id: string | null;
  readonly name: string;
  readonly description: string;
  readonly permission_codes: string[];
  readonly version: number;
  readonly active: boolean;
}

interface RoleProfileRow {
  readonly id: string;
  readonly owner_type: RoleProfileRecord['ownerType'];
  readonly tenant_id: string | null;
  readonly name: string;
  readonly description: string;
  readonly scope_ceiling: RoleProfileRecord['scopeCeiling'];
  readonly role_ids: string[];
  readonly permission_codes: string[];
  readonly version: number;
  readonly active: boolean;
}

interface AssignmentRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly role_profile_id: string;
  readonly profile_name: string;
  readonly profile_version: number;
  readonly scope_type: AccessAssignmentRecord['scopeType'];
  readonly facility_ids: string[];
  readonly status: AccessAssignmentRecord['status'];
  readonly valid_from: Date;
  readonly valid_until: Date;
  readonly version: number;
}

interface AuthorityGrantRow {
  readonly id: string;
  readonly subject_user_id: string;
  readonly issued_by_user_id: string;
  readonly approved_by_user_id: string | null;
  readonly parent_grant_id: string | null;
  readonly approved_under_grant_id: string | null;
  readonly role_profile_id: string;
  readonly level: AuthorityGrantRecord['level'];
  readonly permission_codes: string[];
  readonly resource_classes: string[];
  readonly geographic_unit_ids: string[];
  readonly national_scope: boolean;
  readonly purpose: string;
  readonly human_reason: string;
  readonly status: AuthorityGrantRecord['status'];
  readonly valid_from: Date;
  readonly expires_at: Date;
  readonly allows_pii: boolean;
  readonly allows_document_content: boolean;
  readonly allows_export: boolean;
  readonly allows_intervention: boolean;
  readonly version: number;
}

const ROLE_SELECT = `
  SELECT r.id, r.owner_type, r.tenant_id, r.name, r.description, r.version, r.active,
         COALESCE(
           array_agg(rp.permission_code ORDER BY rp.permission_code)
             FILTER (WHERE rp.permission_code IS NOT NULL),
           ARRAY[]::varchar[]
         ) AS permission_codes
    FROM access_control.roles r
    LEFT JOIN access_control.role_permissions rp ON rp.role_id = r.id`;

const PROFILE_SELECT = `
  SELECT p.id, p.owner_type, p.tenant_id, p.name, p.description, p.scope_ceiling,
         p.version, p.active,
         COALESCE(
           (SELECT array_agg(pr.role_id ORDER BY pr.role_id)
              FROM access_control.role_profile_roles pr
             WHERE pr.profile_id = p.id),
           ARRAY[]::uuid[]
         ) AS role_ids,
         COALESCE(
           (SELECT array_agg(DISTINCT rp.permission_code ORDER BY rp.permission_code)
              FROM access_control.role_profile_roles pr
              JOIN access_control.roles r ON r.id = pr.role_id AND r.active
              JOIN access_control.role_permissions rp ON rp.role_id = r.id
              JOIN access_control.permissions permission
                ON permission.code = rp.permission_code AND permission.active
             WHERE pr.profile_id = p.id),
           ARRAY[]::varchar[]
         ) AS permission_codes
    FROM access_control.role_profiles p`;

const ASSIGNMENT_SELECT = `
  SELECT a.id, a.tenant_id, a.user_id, a.role_profile_id, p.name AS profile_name,
         p.version AS profile_version, a.scope_type,
         COALESCE(
           (SELECT array_agg(af.facility_id ORDER BY af.facility_id)
              FROM access_control.access_assignment_facilities af
             WHERE af.assignment_id = a.id),
           ARRAY[]::uuid[]
         ) AS facility_ids,
         CASE
            WHEN a.status = 'ACTIVE' AND a.valid_until <= now()
             THEN 'EXPIRED'
           ELSE a.status
         END AS status,
         a.valid_from, a.valid_until, a.version
    FROM access_control.access_assignments a
    JOIN access_control.role_profiles p ON p.id = a.role_profile_id`;

const AUTHORITY_SELECT = `
  SELECT g.id, g.subject_user_id, g.issued_by_user_id, g.approved_by_user_id,
          g.parent_grant_id, g.approved_under_grant_id, g.role_profile_id, g.level,
          g.national_scope, g.purpose, g.human_reason,
         CASE WHEN g.status = 'ACTIVE' AND g.expires_at <= now() THEN 'EXPIRED' ELSE g.status END
           AS status,
          g.valid_from, g.expires_at, g.allows_pii, g.allows_document_content,
          g.allows_export, g.allows_intervention, g.version,
         COALESCE(
           (SELECT array_agg(gp.permission_code ORDER BY gp.permission_code)
              FROM access_control.authority_grant_permissions gp
             WHERE gp.grant_id = g.id),
           ARRAY[]::varchar[]
         ) AS permission_codes,
         COALESCE(
           (SELECT array_agg(gr.resource_class ORDER BY gr.resource_class)
              FROM access_control.authority_grant_resources gr
             WHERE gr.grant_id = g.id),
           ARRAY[]::varchar[]
         ) AS resource_classes,
         COALESCE(
           (SELECT array_agg(gg.geographic_unit_id ORDER BY gg.geographic_unit_id)
              FROM access_control.authority_grant_geographies gg
             WHERE gg.grant_id = g.id),
           ARRAY[]::uuid[]
         ) AS geographic_unit_ids
    FROM access_control.authority_grants g`;

function invalid(field: string, code = 'INVALID'): ApplicationError {
  return new ApplicationError({
    code: 'REQUEST.VALIDATION_FAILED',
    message: 'One or more request fields are invalid.',
    status: 400,
    details: [{ field, code }],
  });
}

function roleFrom(row: RoleRow): RoleRecord {
  return {
    id: row.id,
    ownerType: row.owner_type,
    ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
    name: row.name,
    description: row.description,
    permissionCodes: Object.freeze([...row.permission_codes]),
    version: row.version,
    active: row.active,
  };
}

function profileFrom(row: RoleProfileRow): RoleProfileRecord {
  return {
    id: row.id,
    ownerType: row.owner_type,
    ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
    name: row.name,
    description: row.description,
    scopeCeiling: row.scope_ceiling,
    roleIds: Object.freeze([...row.role_ids]),
    permissionCodes: Object.freeze([...row.permission_codes]),
    version: row.version,
    active: row.active,
  };
}

function assignmentFrom(row: AssignmentRow): AccessAssignmentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    roleProfileId: row.role_profile_id,
    profileName: row.profile_name,
    profileVersion: row.profile_version,
    scopeType: row.scope_type,
    facilityIds: Object.freeze([...row.facility_ids]),
    status: row.status,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    version: row.version,
  };
}

function authorityFrom(row: AuthorityGrantRow): AuthorityGrantRecord {
  return {
    id: row.id,
    subjectUserId: row.subject_user_id,
    issuedByUserId: row.issued_by_user_id,
    ...(row.approved_by_user_id === null ? {} : { approvedByUserId: row.approved_by_user_id }),
    ...(row.parent_grant_id === null ? {} : { parentGrantId: row.parent_grant_id }),
    ...(row.approved_under_grant_id === null
      ? {}
      : { approvedUnderGrantId: row.approved_under_grant_id }),
    roleProfileId: row.role_profile_id,
    level: row.level,
    permissionCodes: Object.freeze([...row.permission_codes]),
    resourceClasses: Object.freeze([...row.resource_classes]),
    geographicUnitIds: Object.freeze([...row.geographic_unit_ids]),
    nationalScope: row.national_scope,
    purpose: row.purpose,
    humanReason: row.human_reason,
    status: row.status,
    validFrom: row.valid_from,
    expiresAt: row.expires_at,
    allowsPii: row.allows_pii,
    allowsDocumentContent: row.allows_document_content,
    allowsExport: row.allows_export,
    allowsIntervention: row.allows_intervention,
    version: row.version,
  };
}

@Injectable()
export class PostgresAccessAdministrationRepository implements AccessAdministrationRepository {
  async listPermissionCatalog(
    transaction: TransactionContext,
    allowedCodes: readonly string[],
  ): Promise<readonly PermissionCatalogItem[]> {
    if (allowedCodes.length === 0) return [];
    return entityManagerFor(transaction).query(
      `SELECT code, description, resource, action, risk_class AS "riskClass"
         FROM access_control.permissions
        WHERE active AND code = ANY($1::varchar[])
        ORDER BY code`,
      [[...new Set(allowedCodes)]],
    );
  }

  async listRoles(
    transaction: TransactionContext,
    tenantId: string,
  ): Promise<readonly RoleRecord[]> {
    const rows: RoleRow[] = await entityManagerFor(transaction).query(
      `${ROLE_SELECT}
        WHERE r.owner_type = 'SYSTEM' OR r.tenant_id = $1
        GROUP BY r.id
        ORDER BY r.owner_type, r.name, r.id`,
      [tenantId],
    );
    return rows.map(roleFrom);
  }

  async findRole(
    transaction: TransactionContext,
    tenantId: string,
    roleId: string,
  ): Promise<RoleRecord | undefined> {
    const rows: RoleRow[] = await entityManagerFor(transaction).query(
      `${ROLE_SELECT}
        WHERE r.id = $2 AND (r.owner_type = 'SYSTEM' OR r.tenant_id = $1)
        GROUP BY r.id`,
      [tenantId, roleId],
    );
    const row = rows[0];
    return row === undefined ? undefined : roleFrom(row);
  }

  async createRole(
    transaction: TransactionContext,
    input: Parameters<AccessAdministrationRepository['createRole']>[1],
  ): Promise<RoleRecord> {
    const manager = entityManagerFor(transaction);
    await this.ensurePermissions(manager, input.permissionCodes);
    await manager.query(
      `INSERT INTO access_control.roles (
         id, owner_type, tenant_id, name, description, created_by, created_at, updated_at
       ) VALUES ($1, 'TENANT', $2, $3, $4, $5, $6, $6)`,
      [input.id, input.tenantId, input.name, input.description, input.actorId, input.now],
    );
    await this.replaceRolePermissions(
      manager,
      input.id,
      input.tenantId,
      input.permissionCodes,
      input.now,
    );
    return this.requiredRole(manager, input.tenantId, input.id);
  }

  async updateRole(
    transaction: TransactionContext,
    input: Parameters<AccessAdministrationRepository['updateRole']>[1],
  ): Promise<RoleRecord | undefined> {
    const manager = entityManagerFor(transaction);
    await this.ensurePermissions(manager, input.permissionCodes);
    const rows: { id: string }[] = await manager.query(
      `UPDATE access_control.roles
          SET name = $4, description = $5, version = version + 1, updated_at = $6
        WHERE id = $2 AND tenant_id = $1 AND owner_type = 'TENANT' AND active
          AND version = $3
        RETURNING id`,
      [
        input.tenantId,
        input.roleId,
        input.expectedVersion,
        input.name,
        input.description,
        input.now,
      ],
    );
    if (rows.length === 0) return undefined;
    await this.replaceRolePermissions(
      manager,
      input.roleId,
      input.tenantId,
      input.permissionCodes,
      input.now,
    );
    return this.requiredRole(manager, input.tenantId, input.roleId);
  }

  async retireRole(
    transaction: TransactionContext,
    tenantId: string,
    roleId: string,
    expectedVersion: number,
    now: Date,
  ): Promise<boolean> {
    const rows: { id: string }[] = await entityManagerFor(transaction).query(
      `UPDATE access_control.roles
          SET active = false, retired_at = $4, updated_at = $4, version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND owner_type = 'TENANT' AND active
          AND version = $3
        RETURNING id`,
      [tenantId, roleId, expectedVersion, now],
    );
    return rows.length === 1;
  }

  async listRoleProfiles(
    transaction: TransactionContext,
    tenantId: string,
  ): Promise<readonly RoleProfileRecord[]> {
    const rows: RoleProfileRow[] = await entityManagerFor(transaction).query(
      `${PROFILE_SELECT}
        WHERE p.owner_type = 'SYSTEM' OR p.tenant_id = $1
        ORDER BY p.owner_type, p.name, p.id`,
      [tenantId],
    );
    return rows.map(profileFrom);
  }

  async findRoleProfile(
    transaction: TransactionContext,
    tenantId: string,
    profileId: string,
  ): Promise<RoleProfileRecord | undefined> {
    const rows: RoleProfileRow[] = await entityManagerFor(transaction).query(
      `${PROFILE_SELECT}
        WHERE p.id = $2 AND (p.owner_type = 'SYSTEM' OR p.tenant_id = $1)`,
      [tenantId, profileId],
    );
    const row = rows[0];
    return row === undefined ? undefined : profileFrom(row);
  }

  async permissionsForRoles(
    transaction: TransactionContext,
    tenantId: string,
    roleIds: readonly string[],
  ): Promise<readonly string[]> {
    const manager = entityManagerFor(transaction);
    await this.ensureRoles(manager, tenantId, roleIds);
    const rows: { permission_code: string }[] = await manager.query(
      `SELECT DISTINCT rp.permission_code
         FROM access_control.roles r
         JOIN access_control.role_permissions rp ON rp.role_id = r.id
         JOIN access_control.permissions p ON p.code = rp.permission_code AND p.active
        WHERE r.id = ANY($1::uuid[]) AND r.active
          AND (r.owner_type = 'SYSTEM' OR r.tenant_id = $2)
        ORDER BY rp.permission_code`,
      [[...new Set(roleIds)], tenantId],
    );
    return rows.map((row) => row.permission_code);
  }

  async createRoleProfile(
    transaction: TransactionContext,
    input: Parameters<AccessAdministrationRepository['createRoleProfile']>[1],
  ): Promise<RoleProfileRecord> {
    const manager = entityManagerFor(transaction);
    await this.ensureRoles(manager, input.tenantId, input.roleIds);
    await manager.query(
      `INSERT INTO access_control.role_profiles (
         id, owner_type, tenant_id, name, description, scope_ceiling, created_by,
         created_at, updated_at
       ) VALUES ($1, 'TENANT', $2, $3, $4, $5, $6, $7, $7)`,
      [
        input.id,
        input.tenantId,
        input.name,
        input.description,
        input.scopeCeiling,
        input.actorId,
        input.now,
      ],
    );
    await this.replaceProfileRoles(manager, input.id, input.tenantId, input.roleIds, input.now);
    return this.requiredProfile(manager, input.tenantId, input.id);
  }

  async updateRoleProfile(
    transaction: TransactionContext,
    input: Parameters<AccessAdministrationRepository['updateRoleProfile']>[1],
  ): Promise<RoleProfileRecord | undefined> {
    const manager = entityManagerFor(transaction);
    await this.ensureRoles(manager, input.tenantId, input.roleIds);
    const rows: { id: string }[] = await manager.query(
      `UPDATE access_control.role_profiles
          SET name = $4, description = $5, scope_ceiling = $6,
              version = version + 1, updated_at = $7
        WHERE tenant_id = $1 AND id = $2 AND owner_type = 'TENANT' AND active
          AND version = $3
        RETURNING id`,
      [
        input.tenantId,
        input.profileId,
        input.expectedVersion,
        input.name,
        input.description,
        input.scopeCeiling,
        input.now,
      ],
    );
    if (rows.length === 0) return undefined;
    await this.replaceProfileRoles(
      manager,
      input.profileId,
      input.tenantId,
      input.roleIds,
      input.now,
    );
    return this.requiredProfile(manager, input.tenantId, input.profileId);
  }

  async retireRoleProfile(
    transaction: TransactionContext,
    tenantId: string,
    profileId: string,
    expectedVersion: number,
    now: Date,
  ): Promise<boolean> {
    const rows: { id: string }[] = await entityManagerFor(transaction).query(
      `UPDATE access_control.role_profiles
          SET active = false, retired_at = $4, updated_at = $4, version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND owner_type = 'TENANT' AND active
          AND version = $3
        RETURNING id`,
      [tenantId, profileId, expectedVersion, now],
    );
    return rows.length === 1;
  }

  async listAssignments(
    transaction: TransactionContext,
    tenantId: string,
  ): Promise<readonly AccessAssignmentRecord[]> {
    const rows: AssignmentRow[] = await entityManagerFor(transaction).query(
      `${ASSIGNMENT_SELECT}
        WHERE a.tenant_id = $1
        ORDER BY a.created_at DESC, a.id`,
      [tenantId],
    );
    return rows.map(assignmentFrom);
  }

  async findAssignment(
    transaction: TransactionContext,
    tenantId: string,
    assignmentId: string,
  ): Promise<AccessAssignmentRecord | undefined> {
    const rows: AssignmentRow[] = await entityManagerFor(transaction).query(
      `${ASSIGNMENT_SELECT}
        WHERE a.tenant_id = $1 AND a.id = $2`,
      [tenantId, assignmentId],
    );
    const row = rows[0];
    return row === undefined ? undefined : assignmentFrom(row);
  }

  async createAssignment(
    transaction: TransactionContext,
    input: Parameters<AccessAdministrationRepository['createAssignment']>[1],
  ): Promise<AccessAssignmentRecord> {
    const manager = entityManagerFor(transaction);
    const memberships: { present: boolean }[] = await manager.query(
      `SELECT EXISTS (
         SELECT 1 FROM tenancy.memberships
          WHERE tenant_id = $1 AND user_id = $2 AND status = 'ACTIVE'
       ) AS present`,
      [input.tenantId, input.userId],
    );
    if (memberships[0]?.present !== true) throw invalid('userId', 'ACTIVE_MEMBERSHIP_REQUIRED');
    const profiles: { id: string }[] = await manager.query(
      `SELECT id FROM access_control.role_profiles
        WHERE id = $2 AND active AND (owner_type = 'SYSTEM' OR tenant_id = $1)`,
      [input.tenantId, input.roleProfileId],
    );
    if (profiles.length !== 1) throw invalid('roleProfileId', 'ACTIVE_PROFILE_REQUIRED');
    await this.ensureFacilities(manager, input.tenantId, input.facilityIds);
    await manager.query(
      `UPDATE access_control.access_assignments
          SET status = 'EXPIRED', version = version + 1, updated_at = $3
        WHERE tenant_id = $1 AND user_id = $2 AND status = 'ACTIVE' AND valid_until <= $3`,
      [input.tenantId, input.userId, input.now],
    );
    await manager.query(
      `INSERT INTO access_control.access_assignments (
         id, tenant_id, user_id, role_profile_id, scope_type, status, valid_from,
         valid_until, granted_by, delegation_evidence, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $7, $8, $9::jsonb, $10, $10)`,
      [
        input.id,
        input.tenantId,
        input.userId,
        input.roleProfileId,
        input.scopeType,
        input.validFrom,
        input.validUntil,
        input.grantedBy,
        JSON.stringify(input.delegationEvidence),
        input.now,
      ],
    );
    if (input.facilityIds.length > 0) {
      await manager.query(
        `INSERT INTO access_control.access_assignment_facilities (
           tenant_id, assignment_id, facility_id, created_at
         ) SELECT $1, $2, facility_id, $4
             FROM unnest($3::uuid[]) AS selected(facility_id)`,
        [input.tenantId, input.id, [...new Set(input.facilityIds)], input.now],
      );
    }
    return this.requiredAssignment(manager, input.tenantId, input.id);
  }

  async revokeAssignment(
    transaction: TransactionContext,
    input: Parameters<AccessAdministrationRepository['revokeAssignment']>[1],
  ): Promise<boolean> {
    const manager = entityManagerFor(transaction);
    const rows: { user_id: string }[] = await manager.query(
      `UPDATE access_control.access_assignments
          SET status = 'REVOKED', revoked_at = $4, revoked_by = $3,
              revocation_reason = $5, version = version + 1, updated_at = $4
        WHERE tenant_id = $1 AND id = $2 AND status IN ('ACTIVE', 'SUSPENDED')
        RETURNING user_id`,
      [input.tenantId, input.assignmentId, input.actorId, input.now, input.reason],
    );
    const userId = rows[0]?.user_id;
    if (userId === undefined) return false;
    await manager.query(
      'SELECT access_control.invalidate_credentials_after_assignment_revocation($1, $2, $3)',
      [input.assignmentId, userId, input.now],
    );
    return true;
  }

  async listAuthorityGrants(
    transaction: TransactionContext,
    actorId: string,
  ): Promise<readonly AuthorityGrantRecord[]> {
    const rows: AuthorityGrantRow[] = await entityManagerFor(transaction).query(
      `${AUTHORITY_SELECT}
        WHERE g.subject_user_id = $1 OR g.issued_by_user_id = $1 OR g.approved_by_user_id = $1
        ORDER BY g.created_at DESC, g.id`,
      [actorId],
    );
    return rows.map(authorityFrom);
  }

  async createAuthorityGrant(
    transaction: TransactionContext,
    input: Parameters<AccessAdministrationRepository['createAuthorityGrant']>[1],
  ): Promise<AuthorityGrantRecord> {
    const manager = entityManagerFor(transaction);
    const profiles: { scope_ceiling: RoleProfileRecord['scopeCeiling'] }[] = await manager.query(
      `SELECT scope_ceiling FROM access_control.role_profiles
        WHERE id = $1 AND owner_type = 'SYSTEM' AND active`,
      [input.roleProfileId],
    );
    const profile = profiles[0];
    const requiredCeiling = input.level === 'PLATFORM' ? 'PLATFORM_GRANT' : 'PROVINCE_GRANT';
    if (profile === undefined || profile.scope_ceiling !== requiredCeiling) {
      throw invalid('roleProfileId', 'AUTHORITY_PROFILE_REQUIRED');
    }
    const profilePermissions: { permission_code: string }[] = await manager.query(
      `SELECT DISTINCT rp.permission_code
         FROM access_control.role_profile_roles pr
         JOIN access_control.roles r ON r.id = pr.role_id AND r.active
         JOIN access_control.role_permissions rp ON rp.role_id = r.id
         JOIN access_control.permissions p ON p.code = rp.permission_code AND p.active
        WHERE pr.profile_id = $1`,
      [input.roleProfileId],
    );
    const allowed = new Set(profilePermissions.map((row) => row.permission_code));
    if (input.permissionCodes.some((code) => !allowed.has(code))) {
      throw invalid('permissionCodes', 'PROFILE_CEILING_EXCEEDED');
    }
    const users: { active: boolean }[] = await manager.query(
      'SELECT access_control.authority_target_user_is_active($1, $2) AS active',
      [input.subjectUserId, input.now],
    );
    if (users[0]?.active !== true) throw invalid('subjectUserId', 'ACTIVE_USER_REQUIRED');
    const parents: { id: string }[] = await manager.query(
      `SELECT id
         FROM access_control.authority_grants
        WHERE id = $1 AND subject_user_id = $2 AND status = 'ACTIVE'
          AND valid_from <= $3 AND expires_at > $3`,
      [input.parentGrantId, input.issuedByUserId, input.now],
    );
    if (parents.length !== 1) throw invalid('parentGrantId', 'ACTIVE_PARENT_GRANT_REQUIRED');
    if (input.geographicUnitIds.length > 0) {
      const geographies: { id: string }[] = await manager.query(
        `SELECT id FROM geography.geographic_units
          WHERE id = ANY($1::uuid[]) AND active`,
        [[...new Set(input.geographicUnitIds)]],
      );
      if (geographies.length !== new Set(input.geographicUnitIds).size) {
        throw invalid('geographicUnitIds', 'UNKNOWN_GEOGRAPHY');
      }
    }
    await manager.query(
      `INSERT INTO access_control.authority_grants (
         id, subject_user_id, issued_by_user_id, parent_grant_id, role_profile_id, level,
         national_scope, purpose, human_reason, status, valid_from, expires_at,
         required_assurance, allows_pii, allows_document_content, allows_export,
         allows_intervention, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING_APPROVAL', $10, $11, 'AAL2',
         $12, $13, $14, $15, $16, $16
       )`,
      [
        input.id,
        input.subjectUserId,
        input.issuedByUserId,
        input.parentGrantId,
        input.roleProfileId,
        input.level,
        input.nationalScope,
        input.purpose,
        input.humanReason,
        input.validFrom,
        input.expiresAt,
        input.allowsPii,
        input.allowsDocumentContent,
        input.allowsExport,
        input.allowsIntervention,
        input.now,
      ],
    );
    await manager.query(
      `INSERT INTO access_control.authority_grant_permissions (grant_id, permission_code)
       SELECT $1, value FROM unnest($2::varchar[]) AS selected(value)`,
      [input.id, [...new Set(input.permissionCodes)]],
    );
    await manager.query(
      `INSERT INTO access_control.authority_grant_resources (grant_id, resource_class)
       SELECT $1, value FROM unnest($2::varchar[]) AS selected(value)`,
      [input.id, [...new Set(input.resourceClasses)]],
    );
    if (input.geographicUnitIds.length > 0) {
      await manager.query(
        `INSERT INTO access_control.authority_grant_geographies (grant_id, geographic_unit_id)
         SELECT $1, value FROM unnest($2::uuid[]) AS selected(value)`,
        [input.id, [...new Set(input.geographicUnitIds)]],
      );
    }
    return this.requiredAuthorityGrant(manager, input.id);
  }

  async findAuthorityGrant(
    transaction: TransactionContext,
    grantId: string,
  ): Promise<AuthorityGrantRecord | undefined> {
    const rows: AuthorityGrantRow[] = await entityManagerFor(transaction).query(
      `${AUTHORITY_SELECT} WHERE g.id = $1`,
      [grantId],
    );
    const row = rows[0];
    return row === undefined ? undefined : authorityFrom(row);
  }

  async approveAuthorityGrant(
    transaction: TransactionContext,
    input: Parameters<AccessAdministrationRepository['approveAuthorityGrant']>[1],
  ): Promise<AuthorityGrantRecord | undefined> {
    const manager = entityManagerFor(transaction);
    const approvingGrants: { id: string }[] = await manager.query(
      `SELECT id
         FROM access_control.authority_grants
        WHERE id = $1 AND subject_user_id = $2 AND status = 'ACTIVE'
          AND valid_from <= $3 AND expires_at > $3`,
      [input.approvedUnderGrantId, input.actorId, input.now],
    );
    if (approvingGrants.length !== 1) {
      throw invalid('approvedUnderGrantId', 'ACTIVE_APPROVING_GRANT_REQUIRED');
    }
    const targetUsers: { active: boolean }[] = await manager.query(
      'SELECT access_control.authority_target_user_is_active($1, $2) AS active',
      [input.subjectUserId, input.now],
    );
    if (targetUsers[0]?.active !== true) {
      throw invalid('subjectUserId', 'ACTIVE_USER_REQUIRED');
    }
    const rows: { id: string }[] = await manager.query(
      `UPDATE access_control.authority_grants
          SET status = 'ACTIVE', approved_by_user_id = $3, approved_under_grant_id = $4,
              approved_at = $6, approval_reason = $5, version = version + 1, updated_at = $6
        WHERE id = $1 AND version = $2 AND status = 'PENDING_APPROVAL'
          AND issued_by_user_id <> $3 AND subject_user_id <> $3 AND expires_at > $6
        RETURNING id`,
      [
        input.grantId,
        input.expectedVersion,
        input.actorId,
        input.approvedUnderGrantId,
        input.reason,
        input.now,
      ],
    );
    return rows.length === 0 ? undefined : this.requiredAuthorityGrant(manager, input.grantId);
  }

  async revokeAuthorityGrant(
    transaction: TransactionContext,
    input: Parameters<AccessAdministrationRepository['revokeAuthorityGrant']>[1],
  ): Promise<boolean> {
    const manager = entityManagerFor(transaction);
    const rows: { subject_user_id: string }[] = await manager.query(
      `UPDATE access_control.authority_grants
          SET status = 'REVOKED', revoked_at = $3, revoked_by = $2,
              revocation_reason = $4, version = version + 1, updated_at = $3
        WHERE id = $1 AND status IN ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED')
        RETURNING subject_user_id`,
      [input.grantId, input.actorId, input.now, input.reason],
    );
    const subjectUserId = rows[0]?.subject_user_id;
    if (subjectUserId === undefined) return false;
    await manager.query(
      'SELECT access_control.invalidate_credentials_after_authority_revocation($1, $2, $3)',
      [input.grantId, subjectUserId, input.now],
    );
    return true;
  }

  private async ensurePermissions(
    manager: EntityManager,
    permissionCodes: readonly string[],
  ): Promise<void> {
    const unique = [...new Set(permissionCodes)];
    if (unique.length === 0) throw invalid('permissionCodes', 'NOT_EMPTY');
    const rows: { code: string }[] = await manager.query(
      `SELECT code FROM access_control.permissions
        WHERE active AND code = ANY($1::varchar[])`,
      [unique],
    );
    if (rows.length !== unique.length) throw invalid('permissionCodes', 'UNKNOWN_PERMISSION');
  }

  private async ensureRoles(
    manager: EntityManager,
    tenantId: string,
    roleIds: readonly string[],
  ): Promise<void> {
    const unique = [...new Set(roleIds)];
    if (unique.length === 0) throw invalid('roleIds', 'NOT_EMPTY');
    const rows: { id: string }[] = await manager.query(
      `SELECT id FROM access_control.roles
        WHERE active AND id = ANY($1::uuid[])
          AND (owner_type = 'SYSTEM' OR tenant_id = $2)`,
      [unique, tenantId],
    );
    if (rows.length !== unique.length) throw invalid('roleIds', 'UNKNOWN_ROLE');
  }

  private async ensureFacilities(
    manager: EntityManager,
    tenantId: string,
    facilityIds: readonly string[],
  ): Promise<void> {
    const unique = [...new Set(facilityIds)];
    if (unique.length === 0) return;
    const rows: { id: string }[] = await manager.query(
      `SELECT id FROM tenancy.facilities
        WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND operating_status = 'ACTIVE'`,
      [tenantId, unique],
    );
    if (rows.length !== unique.length) throw invalid('facilityIds', 'UNKNOWN_FACILITY');
  }

  private async replaceRolePermissions(
    manager: EntityManager,
    roleId: string,
    tenantId: string,
    permissionCodes: readonly string[],
    now: Date,
  ): Promise<void> {
    await manager.query('DELETE FROM access_control.role_permissions WHERE role_id = $1', [roleId]);
    await manager.query(
      `INSERT INTO access_control.role_permissions (
         role_id, permission_code, tenant_id, created_at
       ) SELECT $1, value, $2, $4
           FROM unnest($3::varchar[]) AS selected(value)`,
      [roleId, tenantId, [...new Set(permissionCodes)], now],
    );
  }

  private async replaceProfileRoles(
    manager: EntityManager,
    profileId: string,
    tenantId: string,
    roleIds: readonly string[],
    now: Date,
  ): Promise<void> {
    await manager.query('DELETE FROM access_control.role_profile_roles WHERE profile_id = $1', [
      profileId,
    ]);
    await manager.query(
      `INSERT INTO access_control.role_profile_roles (
         profile_id, role_id, tenant_id, created_at
       ) SELECT $1, value, $2, $4
           FROM unnest($3::uuid[]) AS selected(value)`,
      [profileId, tenantId, [...new Set(roleIds)], now],
    );
  }

  private async requiredRole(
    manager: EntityManager,
    tenantId: string,
    roleId: string,
  ): Promise<RoleRecord> {
    const rows: RoleRow[] = await manager.query(
      `${ROLE_SELECT}
        WHERE r.id = $2 AND (r.owner_type = 'SYSTEM' OR r.tenant_id = $1)
        GROUP BY r.id`,
      [tenantId, roleId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('Created role could not be reloaded');
    return roleFrom(row);
  }

  private async requiredProfile(
    manager: EntityManager,
    tenantId: string,
    profileId: string,
  ): Promise<RoleProfileRecord> {
    const rows: RoleProfileRow[] = await manager.query(
      `${PROFILE_SELECT}
        WHERE p.id = $2 AND (p.owner_type = 'SYSTEM' OR p.tenant_id = $1)`,
      [tenantId, profileId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('Created role profile could not be reloaded');
    return profileFrom(row);
  }

  private async requiredAssignment(
    manager: EntityManager,
    tenantId: string,
    assignmentId: string,
  ): Promise<AccessAssignmentRecord> {
    const rows: AssignmentRow[] = await manager.query(
      `${ASSIGNMENT_SELECT}
        WHERE a.tenant_id = $1 AND a.id = $2`,
      [tenantId, assignmentId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('Created access assignment could not be reloaded');
    return assignmentFrom(row);
  }

  private async requiredAuthorityGrant(
    manager: EntityManager,
    grantId: string,
  ): Promise<AuthorityGrantRecord> {
    const rows: AuthorityGrantRow[] = await manager.query(`${AUTHORITY_SELECT} WHERE g.id = $1`, [
      grantId,
    ]);
    const row = rows[0];
    if (row === undefined) throw new Error('Created authority grant could not be reloaded');
    return authorityFrom(row);
  }
}
