import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

export const requiredPhase6Evidence = [
  'NATIVE_IOS_BUILD_INSTALL',
  'NATIVE_ANDROID_BUILD_INSTALL',
  'ACCESSIBILITY_ACCEPTANCE',
  'OFFLINE_COMMAND_RECOVERY',
  'REALTIME_RECONNECT',
  'MOBILE_MINIMUM_VERSION',
  'MANAGED_CONTEXT_AUTHORIZATION',
  'PORTAL_ADAPTERS',
  'PROVIDER_CANARIES',
  'SECURITY_PRIVACY_REVIEW',
  'CAPACITY_SLO',
  'OPERATIONS_DRILL',
] as const;

export const requiredPhase6Personas = [
  'REQUESTER',
  'DRIVER',
  'FACILITY_DISPATCHER',
  'FACILITY_ADMIN',
  'TENANT_SUPPORT',
  'TENANT_CASH_OPERATOR',
  'PROVINCE_REVIEWER',
  'AUTHORITY_OPERATOR',
  'PLATFORM_ADMIN',
] as const;

export const requiredPhase6Providers = [
  'ROUTING_MAPS',
  'OTP_MESSAGING',
  'OUTBOUND_NOTIFICATIONS',
  'PRIVATE_OBJECT_STORAGE',
  'MALWARE_SCANNING',
] as const;

const acceptance = z
  .object({
    status: z.enum(['PASS', 'FAIL', 'PENDING']),
    artifactSha256: hash,
    owner: id,
    validUntil: z.iso.datetime(),
  })
  .strict();

export const phase6AcceptanceSchema = z
  .object({
    formatVersion: z.literal(1),
    releaseCommit: z.string().regex(/^[a-f0-9]{40}$/),
    evaluatedAt: z.iso.datetime(),
    evidence: z.array(acceptance.extend({ kind: z.enum(requiredPhase6Evidence) }).strict()),
    personas: z.array(acceptance.extend({ persona: z.enum(requiredPhase6Personas) }).strict()),
    providers: z.array(acceptance.extend({ provider: z.enum(requiredPhase6Providers) }).strict()),
    unresolvedCriticalOrHigh: z.number().int().nonnegative(),
  })
  .strict();

export type Phase6AcceptanceInput = z.infer<typeof phase6AcceptanceSchema>;

/** Verifies evidence inventory only. Named owners still decide Gate 6. */
export function evaluatePhase6Acceptance(
  value: unknown,
  now = new Date(),
): {
  formatVersion: 1;
  releaseCommit: string;
  disposition: 'HOLD' | 'READY_FOR_OWNER_REVIEW';
  gateApproved: false;
  productionAuthorized: false;
  blockers: string[];
} {
  const input = phase6AcceptanceSchema.parse(value);
  const blockers = new Set<string>();
  const nowTime = now.getTime();
  const evaluatedAt = Date.parse(input.evaluatedAt);
  if (evaluatedAt > nowTime || nowTime - evaluatedAt > 60 * 60 * 1000)
    blockers.add('STALE_EVALUATION');
  const check = (
    required: readonly string[],
    rows: readonly ({ status: 'PASS' | 'FAIL' | 'PENDING'; validUntil: string } & Record<
      string,
      unknown
    >)[],
    key: string,
    prefix: string,
  ): void => {
    for (const expected of required) {
      const matches = rows.filter((row) => row[key] === expected);
      if (
        matches.length !== 1 ||
        matches[0]?.status !== 'PASS' ||
        Date.parse(matches[0].validUntil) <= nowTime
      )
        blockers.add(`${prefix}_${expected}`);
    }
  };
  check(requiredPhase6Evidence, input.evidence, 'kind', 'EVIDENCE');
  check(requiredPhase6Personas, input.personas, 'persona', 'PERSONA');
  check(requiredPhase6Providers, input.providers, 'provider', 'PROVIDER');
  if (input.unresolvedCriticalOrHigh) blockers.add('UNRESOLVED_CRITICAL_HIGH');
  return {
    formatVersion: 1,
    releaseCommit: input.releaseCommit,
    disposition: blockers.size ? 'HOLD' : 'READY_FOR_OWNER_REVIEW',
    gateApproved: false,
    productionAuthorized: false,
    blockers: [...blockers].sort(),
  };
}
