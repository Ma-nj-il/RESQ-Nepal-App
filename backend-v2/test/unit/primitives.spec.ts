import { RequestContext } from '../../src/shared/application/context/request-context.js';
import { UuidV7Generator } from '../../src/shared/infrastructure/identifiers/uuid-v7-generator.js';
import { SystemClock } from '../../src/shared/infrastructure/time/system-clock.js';

describe('injectable primitives', () => {
  it('generates RFC 9562 version 7 UUIDs', () => {
    const id = new UuidV7Generator().generate();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('returns defensive Date values from the system clock', () => {
    expect(new SystemClock().now()).toBeInstanceOf(Date);
  });

  it('freezes request context and copied facility scope', () => {
    const facilities = ['018f0000-0000-7000-8000-000000000001'];
    const context = new RequestContext({
      requestId: '018f0000-0000-7000-8000-000000000002',
      correlationId: '018f0000-0000-7000-8000-000000000002',
      source: 'HTTP',
      scope: { tenantId: '018f0000-0000-7000-8000-000000000003', facilityIds: facilities },
    });
    facilities.push('018f0000-0000-7000-8000-000000000004');

    expect(context.scope.facilityIds).toHaveLength(1);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.scope.facilityIds)).toBe(true);
  });
});
