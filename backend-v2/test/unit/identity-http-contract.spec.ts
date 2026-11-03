import { jest } from '@jest/globals';
import type { Response } from 'express';

import type { AccessAdministrationService } from '../../src/identity-access/application/access-administration.service.js';
import { AccessAdministrationController } from '../../src/identity-access/presentation/http/access-administration.controller.js';
import { RequestContext } from '../../src/shared/application/context/request-context.js';
import { RequestContextStorage } from '../../src/shared/infrastructure/context/request-context.storage.js';

const CONTEXT = new RequestContext({
  requestId: 'request-id',
  correlationId: 'correlation-id',
  source: 'HTTP',
  actor: { type: 'USER', id: '018f0000-0000-7000-8000-000000000001' },
  authentication: {
    assurance: 'AAL2',
    assuranceExpiresAt: new Date('2026-11-03T12:05:00.000Z'),
    tokenVersion: 1,
  },
  scope: {
    tenantId: '018f0000-0000-7000-8000-000000000002',
    accessScopeType: 'TENANT',
  },
});

function response(): { value: Response; setHeader: jest.Mock } {
  const setHeader = jest.fn();
  return { value: { setHeader } as unknown as Response, setHeader };
}

describe('identity HTTP command contracts', () => {
  it('requires a valid If-Match version before an update reaches the service', async () => {
    const updateRole = jest.fn();
    const administration = {
      updateRole,
    } as unknown as AccessAdministrationService;
    const contexts = new RequestContextStorage();
    const controller = new AccessAdministrationController(administration, contexts);
    const output = response();

    await contexts.run(CONTEXT, async () => {
      await expect(
        controller.updateRole(
          'role-id',
          {
            name: 'Dispatcher',
            description: 'Dispatch role',
            permissionCodes: ['trip.read'],
            reason: 'Controlled update',
          },
          undefined,
          'idempotency-key-0001',
          output.value,
        ),
      ).rejects.toMatchObject({ code: 'REQUEST.PRECONDITION_REQUIRED', status: 428 });
    });
    expect(updateRole.mock.calls).toHaveLength(0);
  });

  it('surfaces replay evidence for an idempotent command', async () => {
    const administration = {
      createRole: jest.fn(() =>
        Promise.resolve({
          value: { id: 'role-id', version: 1 },
          replayed: true,
          status: 201,
        }),
      ),
    } as unknown as AccessAdministrationService;
    const contexts = new RequestContextStorage();
    const controller = new AccessAdministrationController(administration, contexts);
    const output = response();

    const body = await contexts.run(CONTEXT, () =>
      controller.createRole(
        {
          name: 'Dispatcher',
          description: 'Dispatch role',
          permissionCodes: ['trip.read'],
          reason: 'Controlled creation',
        },
        'idempotency-key-0002',
        output.value,
      ),
    );

    expect(output.setHeader).toHaveBeenCalledWith('Idempotency-Replayed', 'true');
    expect(body).toMatchObject({ data: { id: 'role-id', version: 1 } });
  });
});
