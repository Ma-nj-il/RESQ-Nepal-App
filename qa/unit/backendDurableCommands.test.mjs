import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createSecureCommandVault } from '../../src/services/api/backend/secureCommandVault.ts';
import { DurableCommands } from '../../src/services/api/backend/durableCommands.ts';
import { commandBody } from '../../src/services/api/backend/commandRegistry.ts';
import { BackendError } from '../../src/services/api/backend/errors.ts';

const userId = '00000000-0000-4000-8000-000000000001';
const secondUser = '00000000-0000-4000-8000-000000000002';
const scope = { origin: 'https://api.example.test', environment: 'test' };
const sha256 = async (value) => createHash('sha256').update(value).digest('hex');
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const command = (message = 'नेपाल 🚑'.repeat(500)) => ({
  name: 'createTicket',
  body: commandBody('createTicket', { category: 'SERVICE', message }),
  identity: { idempotencyKey: randomUUID() },
  createdAt: 1000,
  lastAttemptAt: 1000,
  retryAt: 0,
  ambiguous: false,
});

function nativeStore() {
  const data = new Map();
  const writes = [];
  let mutations = 0;
  const controls = { failAt: Infinity, after: false, available: true, barrier: null };
  const mutate = async (work) => {
    const index = ++mutations;
    if (controls.barrier) {
      const barrier = controls.barrier;
      controls.barrier = null;
      barrier.entered?.resolve();
      await barrier.promise;
    }
    if (index === controls.failAt && !controls.after) throw new Error('synthetic native failure');
    work();
    if (index === controls.failAt && controls.after) throw new Error('synthetic lost acknowledgement');
  };
  return {
    data,
    writes,
    controls,
    mutations: () => mutations,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 9,
    isAvailableAsync: async () => controls.available,
    getItemAsync: async (key) => data.get(key) ?? null,
    setItemAsync: async (key, value, options) =>
      mutate(() => {
        assert.ok(Buffer.byteLength(value, 'utf8') <= 2048);
        assert.equal(options.keychainAccessible, 9);
        assert.equal(options.requireAuthentication, false);
        writes.push({ key, value });
        data.set(key, value);
      }),
    deleteItemAsync: async (key) => mutate(() => data.delete(key)),
  };
}
const vault = (native, owner = userId, environment = scope.environment) =>
  createSecureCommandVault(native, { ...scope, environment }, owner, 'product', sha256);
function waitReady(controller) {
  if (controller.store.getState().status !== 'loading') return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = controller.store.subscribe((state) => {
      if (state.status !== 'loading') {
        unsubscribe();
        resolve();
      }
    });
  });
}
function runtime(native, send, clock = () => 1000) {
  let owner = { userId, sessionId: randomUUID() };
  const controller = new DurableCommands(
    'product',
    { createTicket: send },
    (id) => vault(native, id),
    () => owner,
    randomUUID,
    clock,
  );
  controller.activate(owner);
  return {
    controller,
    change(value) {
      owner = value;
      controller.activate(value);
    },
  };
}

test('secure command chunks preserve Nepali text within native limits and isolate accounts/environments', async () => {
  const native = nativeStore(),
    saved = command();
  await vault(native).write(saved);
  assert.deepEqual(await vault(native).read(), saved);
  assert.equal(await vault(native, secondUser).read(), null);
  assert.equal(await vault(native, userId, 'staging').read(), null);
  assert.ok(native.writes.length > 10);
  assert.equal(
    commandBody('createTicket', {
      category: 'SERVICE',
      message: 'test',
      accessToken: 'never-store',
      headers: { Authorization: 'secret' },
    }),
    '{"category":"SERVICE","message":"test"}',
  );
  await vault(native).settle();
  assert.equal(native.data.size, 0);
});

test('every interrupted initial write recovers as unsent or a complete immutable command', async () => {
  const saved = command('long text '.repeat(350));
  const baseline = nativeStore();
  await vault(baseline).write(saved);
  for (let failAt = 1; failAt <= baseline.mutations(); failAt++)
    for (const after of [false, true]) {
      const native = nativeStore();
      Object.assign(native.controls, { failAt, after });
      await assert.rejects(vault(native).write(saved), { code: 'CLIENT.COMMAND_STORAGE_UNAVAILABLE' });
      native.controls.failAt = Infinity;
      const recovered = await vault(native).read();
      if (recovered) assert.deepEqual(recovered, saved);
      else assert.equal(native.data.size, 0);
    }
});

test('settlement crash boundaries never expose a partially deleted command for replay', async () => {
  const saved = command('long text '.repeat(350));
  const baseline = nativeStore();
  await vault(baseline).write(saved);
  const start = baseline.mutations();
  await vault(baseline).settle();
  for (let step = 1; step <= baseline.mutations() - start; step++)
    for (const after of [false, true]) {
      const native = nativeStore();
      await vault(native).write(saved);
      Object.assign(native.controls, { failAt: native.mutations() + step, after });
      await assert.rejects(vault(native).settle());
      native.controls.failAt = Infinity;
      const recovered = await vault(native).read();
      if (step === 1 && !after) assert.deepEqual(recovered, saved);
      else {
        assert.equal(recovered, null);
        assert.equal(native.data.size, 0);
      }
    }
});

test('missing, changed, and cross-command chunks fail closed and cannot be replaced', async () => {
  const native = nativeStore();
  await vault(native).write(command('original'));
  const chunkKey = [...native.data.keys()].find((key) => key.endsWith('.0'));
  const original = native.data.get(chunkKey);
  native.data.set(chunkKey, original.replace('original', 'modified'));
  await assert.rejects(vault(native).read(), { code: 'CLIENT.COMMAND_STORAGE_INVALID' });
  await assert.rejects(vault(native).write(command('another')), { code: 'CLIENT.COMMAND_STORAGE_INVALID' });
  native.data.delete(chunkKey);
  await assert.rejects(vault(native).read(), { code: 'CLIENT.COMMAND_STORAGE_INVALID' });
  assert.ok(native.data.size > 0);
});

test('corrupt phase, ambiguity, identity and retry metadata never permit cleanup or replay', async () => {
  for (const edit of [
    (value) => {
      value.phase = 'SETTLED';
    },
    (value) => {
      value.phase = 'PREPARING';
    },
    (value) => {
      value.ambiguous = false;
    },
    (value) => {
      value.retryAt = 0;
    },
    (value) => {
      value.lastAttemptAt = 1001;
    },
    (value) => {
      value.identity.idempotencyKey = randomUUID();
    },
  ]) {
    const native = nativeStore();
    await vault(native).write({ ...command('pending'), ambiguous: true, retryAt: 21000 });
    const key = [...native.data.keys()].find((item) => item.endsWith('.product'));
    const manifest = JSON.parse(native.data.get(key));
    edit(manifest);
    native.data.set(key, JSON.stringify(manifest));
    const before = new Map(native.data);
    let sends = 0;
    const current = runtime(native, async () => {
      sends++;
    });
    await waitReady(current.controller);
    assert.equal(current.controller.store.getState().status, 'blocked');
    await assert.rejects(current.controller.retry(), { code: 'CLIENT.COMMAND_STORAGE_INVALID' });
    assert.equal(sends, 0);
    assert.deepEqual(native.data, before);
  }
});

test('every pre-dispatch storage acknowledgement is required before sending HTTP', async () => {
  let dispatchBoundary = 0;
  const baseline = nativeStore();
  const first = runtime(baseline, async () => {
    dispatchBoundary = baseline.mutations();
  });
  await waitReady(first.controller);
  await first.controller.submit('createTicket', { category: 'SERVICE', message: 'text '.repeat(700) });
  for (let failAt = 1; failAt <= dispatchBoundary; failAt++)
    for (const after of [false, true]) {
      const native = nativeStore();
      let sends = 0;
      const current = runtime(native, async () => {
        sends++;
      });
      await waitReady(current.controller);
      Object.assign(native.controls, { failAt, after });
      await assert.rejects(
        current.controller.submit('createTicket', { category: 'SERVICE', message: 'text '.repeat(700) }),
      );
      assert.equal(sends, 0);
      native.controls.failAt = Infinity;
      const saved = await vault(native).read();
      if (saved)
        assert.equal(
          saved.body,
          commandBody('createTicket', { category: 'SERVICE', message: 'text '.repeat(700) }),
        );
    }
});

test('lost responses survive process recreation; restore does not send and explicit retry retains identity', async () => {
  const native = nativeStore(),
    sent = [];
  const first = runtime(native, async (body, identity) => {
    sent.push({ body, identity });
    throw new Error('response lost after commit');
  });
  await waitReady(first.controller);
  const input = { category: 'SERVICE', message: 'original' };
  const sending = first.controller.submit('createTicket', input, 7);
  input.message = 'edited';
  assert.equal(first.controller.retry(), sending);
  await assert.rejects(first.controller.submit('createTicket', input), { code: 'CLIENT.COMMAND_PENDING' });
  await assert.rejects(sending);
  assert.equal(first.controller.store.getState().status, 'pending');
  const restarted = runtime(native, async (body, identity) => {
    sent.push({ body, identity });
    return 'confirmed';
  });
  await waitReady(restarted.controller);
  assert.equal(sent.length, 1);
  assert.equal(restarted.controller.store.getState().status, 'pending');
  assert.equal(await restarted.controller.retry(), 'confirmed');
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(sent[1].body.message, 'original');
  assert.equal(sent[1].identity.expectedVersion, 7);
  assert.equal(native.data.size, 0);
  assert.equal(restarted.controller.store.getState().status, 'ready');
});

test('no network dispatch before secure write acknowledgement; locked storage blocks new requests', async () => {
  const native = nativeStore();
  let sends = 0;
  const { controller } = runtime(native, async () => {
    sends++;
  });
  await waitReady(controller);
  native.controls.failAt = 1;
  await assert.rejects(controller.submit('createTicket', { category: 'SERVICE', message: 'test' }));
  assert.equal(sends, 0);
  native.controls.available = false;
  await assert.rejects(controller.retry());
  assert.equal(controller.store.getState().status, 'blocked');
  await assert.rejects(controller.submit('createTicket', { category: 'SERVICE', message: 'test' }), {
    code: 'CLIENT.COMMAND_PENDING',
  });
  assert.equal(sends, 0);
});

test('logout during storage prevents dispatch under a successor account and keeps recovery owner-bound', async () => {
  const native = nativeStore();
  let sends = 0;
  const current = runtime(native, async () => {
    sends++;
  });
  await waitReady(current.controller);
  const barrier = { ...deferred(), entered: deferred() };
  native.controls.barrier = barrier;
  const pending = current.controller.submit('createTicket', { category: 'SERVICE', message: 'private' });
  await barrier.entered.promise;
  current.change(null);
  current.change({ userId: secondUser, sessionId: randomUUID() });
  barrier.resolve();
  await assert.rejects(pending, { code: 'CLIENT.SESSION_CHANGED' });
  await waitReady(current.controller);
  assert.equal(sends, 0);
  assert.equal(await vault(native, secondUser).read(), null);
  assert.equal(current.controller.store.getState().status, 'ready');
  assert.equal(
    (await vault(native).read()).body,
    commandBody('createTicket', { category: 'SERVICE', message: 'private' }),
  );
});

test('Retry-After, clock rollback, and the 23-hour deadline survive a restart', async () => {
  const native = nativeStore();
  let time = 1000,
    sends = 0;
  const send = async () => {
    sends++;
    throw new BackendError({
      code: 'RATE_LIMIT.EXCEEDED',
      message: 'Wait',
      status: 429,
      retryAfterSeconds: 20,
    });
  };
  const first = runtime(native, send, () => time);
  await waitReady(first.controller);
  await assert.rejects(first.controller.submit('createTicket', { category: 'SERVICE', message: 'test' }));
  const next = runtime(native, send, () => time);
  await waitReady(next.controller);
  await assert.rejects(next.controller.retry(), { code: 'CLIENT.RETRY_LATER' });
  time = 999;
  await assert.rejects(next.controller.retry(), { code: 'CLIENT.RECONCILIATION_REQUIRED' });
  time = 1000 + 23 * 60 * 60 * 1000;
  await assert.rejects(next.controller.retry(), { code: 'CLIENT.RECONCILIATION_REQUIRED' });
  assert.equal(sends, 1);
  await assert.rejects(
    next.controller.submit('createTicket', { category: 'SERVICE', message: 'replacement' }),
    { code: 'CLIENT.COMMAND_PENDING' },
  );
});

test('oversized Retry-After remains bounded and cannot erase the retry restriction', async () => {
  const native = nativeStore();
  const current = runtime(native, async () => {
    throw new BackendError({
      code: 'RATE_LIMIT.EXCEEDED',
      message: 'Wait',
      status: 429,
      retryAfterSeconds: 1e100,
    });
  });
  await waitReady(current.controller);
  await assert.rejects(current.controller.submit('createTicket', { category: 'SERVICE', message: 'test' }));
  assert.equal((await vault(native).read()).retryAt, 1000 + 23 * 60 * 60 * 1000);
  await assert.rejects(current.controller.retry(), { code: 'CLIENT.RETRY_LATER' });
});

test('a response after account switch settles only its original command and never publishes its result', async () => {
  const native = nativeStore();
  const response = deferred(),
    entered = deferred();
  const current = runtime(native, async () => {
    entered.resolve();
    return response.promise;
  });
  await waitReady(current.controller);
  const pending = current.controller.submit('createTicket', {
    category: 'SERVICE',
    message: 'first account',
  });
  await entered.promise;
  const successor = { ...command('second account'), ambiguous: true };
  await vault(native, secondUser).write(successor);
  current.change({ userId: secondUser, sessionId: randomUUID() });
  response.resolve('private response');
  await assert.rejects(pending, { code: 'CLIENT.SESSION_CHANGED' });
  await waitReady(current.controller);
  assert.equal(await vault(native).read(), null);
  assert.deepEqual(await vault(native, secondUser).read(), successor);
  assert.equal(current.controller.store.getState().status, 'pending');
});

test('only definitive first rejection releases the command; later rejection preserves ambiguity', async () => {
  const rejection = new BackendError({
    code: 'REQUEST.STALE_VERSION',
    status: 409,
    message: 'Refresh first',
  });
  const native = nativeStore();
  const first = runtime(native, async () => {
    throw rejection;
  });
  await waitReady(first.controller);
  await assert.rejects(first.controller.submit('createTicket', { category: 'SERVICE', message: 'test' }));
  assert.equal(first.controller.store.getState().status, 'ready');
  assert.equal(native.data.size, 0);
  await vault(native).write({ ...command('test'), ambiguous: true });
  const next = runtime(native, async () => {
    throw rejection;
  });
  await waitReady(next.controller);
  await assert.rejects(next.controller.retry());
  assert.equal(next.controller.store.getState().status, 'pending');
  assert.equal((await vault(native).read()).ambiguous, true);
});

test('settled commands are cleaned after restart without another HTTP send', async () => {
  const native = nativeStore();
  let sends = 0;
  const current = runtime(native, async () => {
    sends++;
    native.controls.failAt = native.mutations() + 2; // settlement marker succeeds, first chunk deletion fails
    return 'confirmed';
  });
  await waitReady(current.controller);
  await assert.rejects(current.controller.submit('createTicket', { category: 'SERVICE', message: 'test' }));
  native.controls.failAt = Infinity;
  const restarted = runtime(native, async () => {
    sends++;
  });
  await waitReady(restarted.controller);
  await restarted.controller.retry();
  assert.equal(sends, 1);
  assert.equal(native.data.size, 0);
  assert.equal(restarted.controller.store.getState().status, 'ready');
});
