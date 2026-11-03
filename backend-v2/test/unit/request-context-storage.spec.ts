import { RequestContext } from '../../src/shared/application/context/request-context.js';
import { RequestContextStorage } from '../../src/shared/infrastructure/context/request-context.storage.js';

function context(id: string, authenticated = false): RequestContext {
  return new RequestContext({
    requestId: id,
    correlationId: id,
    source: 'HTTP',
    ...(authenticated
      ? { actor: { type: 'USER', id: `user-${id}` }, sessionId: `session-${id}` }
      : {}),
  });
}

describe('request context across asynchronous authorization', () => {
  it('publishes the resolved actor to the awaiting handler continuation', async () => {
    const storage = new RequestContextStorage();
    await storage.run(context('first'), async () => {
      const guard = async (): Promise<void> => {
        await Promise.resolve();
        storage.replace(context('first', true));
      };
      await guard();
      expect(storage.require().actor?.id).toBe('user-first');
      expect(storage.require().sessionId).toBe('session-first');
    });
    expect(storage.get()).toBeUndefined();
  });

  it('isolates overlapping requests and restores the outer context after nested work', async () => {
    const storage = new RequestContextStorage();
    await Promise.all(
      ['first', 'second'].map((id) =>
        storage.run(context(id), async () => {
          await Promise.resolve();
          storage.replace(context(id, true));
          await storage.run(context('nested'), async () => {
            await Promise.resolve();
            storage.replace(context('nested', true));
            expect(storage.require().actor?.id).toBe('user-nested');
          });
          expect(storage.require().actor?.id).toBe(`user-${id}`);
        }),
      ),
    );
    expect(storage.get()).toBeUndefined();
  });

  it('refuses replacement outside a request instead of creating ambient authentication', () => {
    const storage = new RequestContextStorage();
    expect(() => storage.replace(context('outside', true))).toThrow(
      'Request context is unavailable',
    );
    expect(storage.get()).toBeUndefined();
  });
});
