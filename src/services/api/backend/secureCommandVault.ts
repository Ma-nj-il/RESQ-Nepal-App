import type * as SecureStore from 'expo-secure-store';
import type { IntentIdentity } from './commandIntent';
import {
  type CommandLane,
  type CommandName,
  commandBody,
  isLaneCommand,
  validateCommandIdentity,
} from './commandRegistry';
import { BackendError } from './errors';
import { refreshVaultKey, type VaultScope } from './secureRefreshVault';
import { uuid } from './decoders';

type SecureStorePort = Pick<
  typeof SecureStore,
  'isAvailableAsync' | 'getItemAsync' | 'setItemAsync' | 'deleteItemAsync' | 'WHEN_UNLOCKED_THIS_DEVICE_ONLY'
>;
export interface SavedCommand {
  name: CommandName;
  body: string;
  identity: IntentIdentity;
  createdAt: number;
  lastAttemptAt: number;
  retryAt: number;
  ambiguous: boolean;
}
export interface CommandVault {
  read(): Promise<SavedCommand | null>;
  write(command: SavedCommand): Promise<void>;
  settle(): Promise<void>;
}

const CHUNK_SIZE = 1024;
const MAX_CHUNKS = 64;
const invalid = () =>
  new BackendError({
    code: 'CLIENT.COMMAND_STORAGE_INVALID',
    message:
      'Saved request recovery needs attention. Check its server outcome before creating another request.',
  });
const unavailable = () =>
  new BackendError({
    code: 'CLIENT.COMMAND_STORAGE_UNAVAILABLE',
    message: 'Secure request storage is unavailable. Unlock the device and retry recovery.',
  });

// ASCII escaping bounds actual bytes on native stores, including Nepali text and surrogate pairs.
const ascii = (value: unknown) =>
  JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
type Manifest = Omit<SavedCommand, 'body'> & {
  format: 1;
  owner: string;
  lane: CommandLane;
  phase: 'PREPARING' | 'PENDING' | 'SETTLED';
  chunks: number;
  digest: string;
};

/** One exclusive owner per scope/user/lane. The manifest is the atomic commit point. */
export function createSecureCommandVault(
  store: SecureStorePort,
  scope: VaultScope,
  owner: string,
  lane: CommandLane,
  sha256: (value: string) => Promise<string>,
): CommandVault {
  const key = `${refreshVaultKey(scope)}.commands.${uuid(owner)}.${lane}`;
  const options: SecureStore.SecureStoreOptions = {
    keychainService: key,
    keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: false,
  };
  const native = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      if (!(await store.isAvailableAsync())) throw new Error('Unavailable');
      return await work();
    } catch {
      throw unavailable();
    }
  };
  const manifestChecksum = (value: Manifest) => native(() => sha256(ascii([key, value])));
  const manifest = async (): Promise<Manifest | null> => {
    const raw = await native(() => store.getItemAsync(key, options));
    if (raw === null) return null;
    let value: Manifest;
    let checksum: string;
    try {
      if (raw.length > 2048) throw invalid();
      ({ checksum, ...value } = JSON.parse(raw) as Manifest & { checksum: string });
      if (
        !/^[a-f0-9]{64}$/.test(checksum) ||
        value.format !== 1 ||
        value.owner !== owner ||
        value.lane !== lane ||
        !isLaneCommand(lane, value.name) ||
        !['PREPARING', 'PENDING', 'SETTLED'].includes(value.phase) ||
        !Number.isInteger(value.chunks) ||
        value.chunks < 1 ||
        value.chunks > MAX_CHUNKS ||
        !/^[a-f0-9]{64}$/.test(value.digest) ||
        uuid(value.identity.idempotencyKey) !== value.identity.idempotencyKey ||
        (value.identity.expectedVersion !== undefined &&
          (!Number.isSafeInteger(value.identity.expectedVersion) || value.identity.expectedVersion < 0)) ||
        typeof value.ambiguous !== 'boolean' ||
        ![value.createdAt, value.lastAttemptAt, value.retryAt].every(
          (item) => Number.isSafeInteger(item) && item >= 0,
        ) ||
        value.lastAttemptAt < value.createdAt
      )
        throw invalid();
    } catch {
      throw invalid();
    }
    // Verify phase and retry/ambiguity metadata before cleanup or replay decisions.
    if ((await manifestChecksum(value)) !== checksum) throw invalid();
    return value;
  };
  const saveManifest = async (value: Manifest) => {
    const raw = ascii({ ...value, checksum: await manifestChecksum(value) });
    if (raw.length > 2048) throw invalid();
    await native(() => store.setItemAsync(key, raw, options));
  };
  const digest = (value: Omit<SavedCommand, 'body'>, raw: string) =>
    native(() =>
      sha256(
        JSON.stringify([
          key,
          value.name,
          value.identity.idempotencyKey,
          value.identity.expectedVersion ?? null,
          value.createdAt,
          raw,
        ]),
      ),
    );
  const cleanup = async (value: Manifest) => {
    // PREPARING never dispatched. SETTLED must never dispatch again. Keep the marker until cleanup completes.
    for (let index = 0; index < value.chunks; index++)
      await native(() => store.deleteItemAsync(`${key}.${index}`, options));
    await native(() => store.deleteItemAsync(key, options));
  };
  const read = async (): Promise<SavedCommand | null> => {
    const value = await manifest();
    if (!value) return null;
    if (value.phase !== 'PENDING') {
      await cleanup(value);
      return null;
    }
    let raw = '';
    for (let index = 0; index < value.chunks; index++) {
      const chunk = await native(() => store.getItemAsync(`${key}.${index}`, options));
      if (chunk === null || chunk.length < 1 || chunk.length > CHUNK_SIZE || /[^\x00-\x7f]/.test(chunk))
        throw invalid();
      raw += chunk;
    }
    if ((await digest(value, raw)) !== value.digest) throw invalid();
    try {
      const body = JSON.parse(raw);
      if (typeof body !== 'string' || typeof JSON.parse(body) !== 'object' || JSON.parse(body) === null)
        throw invalid();
      return {
        name: value.name,
        body,
        identity: value.identity,
        createdAt: value.createdAt,
        lastAttemptAt: value.lastAttemptAt,
        retryAt: value.retryAt,
        ambiguous: value.ambiguous,
      };
    } catch {
      throw invalid();
    }
  };
  return {
    read,
    async write(command) {
      if (!isLaneCommand(lane, command.name)) throw invalid();
      validateCommandIdentity(command.name, command.identity);
      if (
        ![command.createdAt, command.lastAttemptAt, command.retryAt].every(
          (time) => Number.isSafeInteger(time) && time >= 0,
        ) ||
        command.lastAttemptAt < command.createdAt ||
        typeof command.ambiguous !== 'boolean' ||
        command.body !== commandBody(command.name, JSON.parse(command.body))
      )
        throw invalid();
      const previous = await read();
      const raw = ascii(command.body);
      const chunks = Math.ceil(raw.length / CHUNK_SIZE);
      if (chunks > MAX_CHUNKS)
        throw new BackendError({
          code: 'CLIENT.COMMAND_TOO_LARGE',
          message: 'This request is too large for secure recovery storage.',
        });
      const { body: _body, ...metadata } = command;
      const value: Manifest = {
        ...metadata,
        format: 1,
        owner,
        lane,
        phase: 'PENDING',
        chunks,
        digest: await digest(metadata, raw),
      };
      if (previous) {
        if (
          previous.body !== command.body ||
          previous.name !== command.name ||
          previous.createdAt !== command.createdAt ||
          previous.identity.idempotencyKey !== command.identity.idempotencyKey ||
          previous.identity.expectedVersion !== command.identity.expectedVersion ||
          previous.lastAttemptAt > command.lastAttemptAt ||
          (previous.ambiguous && !command.ambiguous)
        )
          throw invalid();
      } else {
        // Reserve a cleanup manifest BEFORE writing chunks. No payload is ever sent from this state.
        await saveManifest({ ...value, phase: 'PREPARING' });
        for (let index = 0; index < chunks; index++)
          await native(() =>
            store.setItemAsync(
              `${key}.${index}`,
              raw.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
              options,
            ),
          );
      }
      await saveManifest(value);
    },
    async settle() {
      const value = await manifest();
      if (!value) return;
      await saveManifest({ ...value, phase: 'SETTLED' });
      await cleanup(value);
    },
  };
}
