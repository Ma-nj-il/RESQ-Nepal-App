import { EventEmitter } from 'node:events';
import type { Consumer } from 'kafkajs';
import { RedisRecoveryHints } from '../../src/realtime/infrastructure/redis-recovery-hints.js';
import { loadApplicationConfig } from '../../src/shared/infrastructure/config/application-config.js';
import type { KafkaService } from '../../src/shared/infrastructure/dependencies/kafka.service.js';
import type { RedisService } from '../../src/shared/infrastructure/dependencies/redis.service.js';

function fixture(outcomes: ('join' | 'loading' | 'denied' | 'wait')[]): {
  source: RedisRecoveryHints;
  peers: EventEmitter[];
} {
  const peers: EventEmitter[] = [];
  const cache = Object.assign(new EventEmitter(), {
    status: 'ready',
    connect: async () => {},
    subscribe: async () => {},
    disconnect: () => {},
  });
  const source = new RedisRecoveryHints(
    loadApplicationConfig({ NODE_ENV: 'test' }, 'api'),
    {
      createConsumer: () => {
        const outcome = outcomes[peers.length] ?? 'denied';
        const peer = new EventEmitter();
        peers.push(peer);
        return {
          events: { GROUP_JOIN: 'join', CRASH: 'crash', DISCONNECT: 'disconnect' },
          on: (event: string, listener: (...args: unknown[]) => void) => {
            peer.on(event, listener);
            return () => {
              peer.off(event, listener);
            };
          },
          connect: async () => {},
          subscribe: async () => {},
          run: () => {
            if (outcome === 'join') peer.emit('join');
            else if (outcome !== 'wait') {
              peer.emit('disconnect');
              peer.emit('crash', {
                payload: {
                  error: Object.assign(new Error(outcome), {
                    type:
                      outcome === 'loading'
                        ? 'GROUP_LOAD_IN_PROGRESS'
                        : 'GROUP_AUTHORIZATION_FAILED',
                  }),
                },
              });
            }
            return Promise.resolve();
          },
          disconnect: () => {
            peer.emit('disconnect');
            return Promise.resolve();
          },
        } as unknown as Consumer;
      },
    } as unknown as KafkaService,
    {
      check: async () => {},
      client: () => ({ duplicate: () => cache }),
    } as unknown as RedisService,
  );
  return { source, peers };
}

describe('realtime consumer startup ownership', () => {
  it('retries coordinator loading before join, then permanently fails on a runtime crash', async () => {
    const { source, peers } = fixture(['loading', 'join']);
    try {
      await source.start();
      expect(peers).toHaveLength(2);
      expect(source.ready()).toBe(true);
      let notified = false;
      source.subscribe(
        () => {},
        () => {
          throw new Error('failed listener');
        },
      );
      source.subscribe(
        () => {},
        () => {
          notified = true;
        },
      );
      peers[0]?.emit('join'); // discarded attempt cannot change ownership
      peers[1]?.emit('crash', { payload: { error: new Error('runtime failure') } });
      expect(source.ready()).toBe(false);
      expect(notified).toBe(true);
      peers[1]?.emit('join');
      expect(source.ready()).toBe(false);
      await expect(source.start()).rejects.toThrow('cannot be restarted');
    } finally {
      await source.onModuleDestroy();
    }
  });

  it('bounds coordinator-loading retries to four attempts', async () => {
    const { source, peers } = fixture(['loading', 'loading', 'loading', 'loading', 'join']);
    await expect(source.start()).rejects.toMatchObject({ type: 'GROUP_LOAD_IN_PROGRESS' });
    expect(peers).toHaveLength(4);
    expect(source.ready()).toBe(false);
  });

  it('does not retry authorization failure even when run resolves after crashing', async () => {
    const { source, peers } = fixture(['denied', 'join']);
    await expect(source.start()).rejects.toMatchObject({ type: 'GROUP_AUTHORIZATION_FAILED' });
    expect(peers).toHaveLength(1);
    expect(source.ready()).toBe(false);
  });

  it('keeps readiness down until join and cancels a pending startup on shutdown', async () => {
    const { source, peers } = fixture(['wait']);
    const starting = source.start();
    const rejected = expect(starting).rejects.toThrow('startup cancelled');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(peers).toHaveLength(1);
    expect(source.ready()).toBe(false);
    await source.onModuleDestroy();
    await rejected;
    peers[0]?.emit('join');
    expect(source.ready()).toBe(false);
  });
});
