import { createStore } from 'zustand/vanilla';
import { BackendError } from './errors';
import type { IntentIdentity } from './commandIntent';
import {
  type CommandHandlers,
  type CommandInput,
  type CommandLane,
  type CommandName,
  type CommandResult,
  commandBody,
  isLaneCommand,
  validateCommandIdentity,
} from './commandRegistry';
import type { CommandVault, SavedCommand } from './secureCommandVault';

interface Owner {
  userId: string;
  sessionId: string;
}
interface CommandState {
  status: 'signedOut' | 'loading' | 'ready' | 'pending' | 'running' | 'blocked';
  name: CommandName | null;
  createdAt: number | null;
  notice: string | null;
}
const changed = () =>
  new BackendError({
    code: 'CLIENT.SESSION_CHANGED',
    message: 'Sign in to the original account to recover this request.',
  });
const definitive = (error: unknown) =>
  error instanceof BackendError &&
  !error.code.startsWith('CLIENT.') &&
  ([400, 403, 404, 412, 422].includes(error.status) ||
    (error.status === 409 && error.code === 'REQUEST.STALE_VERSION'));

/** One queue per UI lane; survives remounts. Recovery always waits for an explicit user retry. */
export class DurableCommands {
  readonly store = createStore<CommandState>(() => ({
    status: 'signedOut',
    name: null,
    createdAt: null,
    notice: null,
  }));
  private tail: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private owner: Owner | null = null;
  private inFlight?: Promise<unknown>;
  private readonly lane: CommandLane;
  private readonly handlers: CommandHandlers;
  private readonly vaultFor: (owner: string) => CommandVault;
  private readonly currentOwner: () => Owner | null;
  private readonly generateId: () => string;
  private readonly now: () => number;

  constructor(
    lane: CommandLane,
    handlers: CommandHandlers,
    vaultFor: (owner: string) => CommandVault,
    currentOwner: () => Owner | null,
    generateId: () => string,
    now = Date.now,
  ) {
    this.lane = lane;
    this.handlers = handlers;
    this.vaultFor = vaultFor;
    this.currentOwner = currentOwner;
    this.generateId = generateId;
    this.now = now;
  }

  activate(owner: Owner | null): void {
    if (owner?.userId === this.owner?.userId && owner?.sessionId === this.owner?.sessionId) return;
    this.owner = owner;
    const generation = ++this.generation;
    this.inFlight = undefined;
    this.store.setState({
      status: owner ? 'loading' : 'signedOut',
      name: null,
      createdAt: null,
      notice: null,
    });
    if (owner)
      void this.queue(async () => {
        try {
          const saved = await this.vaultFor(owner.userId).read();
          this.assertOwner(owner, generation);
          this.show(
            saved,
            saved
              ? 'An interrupted request is saved. Retry it explicitly, or inspect its server outcome.'
              : null,
          );
        } catch (error) {
          if (generation === this.generation) this.failure(error);
        }
      });
  }

  submit<K extends CommandName>(
    name: K,
    value: CommandInput<K>,
    expectedVersion?: number,
  ): Promise<CommandResult<K>> {
    if (this.inFlight || this.store.getState().status !== 'ready' || !isLaneCommand(this.lane, name))
      return Promise.reject(
        new BackendError({
          code: 'CLIENT.COMMAND_PENDING',
          message: 'Recover the saved request before starting another.',
        }),
      );
    try {
      const time = this.now();
      const command: SavedCommand = {
        name,
        body: commandBody(name, value),
        identity: { idempotencyKey: this.generateId(), expectedVersion },
        createdAt: time,
        lastAttemptAt: time,
        retryAt: 0,
        ambiguous: false,
      };
      validateCommandIdentity(name, command.identity);
      return this.execute(command) as Promise<CommandResult<K>>;
    } catch (error) {
      this.show(null, error instanceof BackendError ? error.message : 'Invalid request input.');
      return Promise.reject(error);
    }
  }

  retry(): Promise<unknown> {
    if (this.inFlight) return this.inFlight;
    return this.execute();
  }

  private execute(initial?: SavedCommand): Promise<unknown> {
    const owner = this.owner;
    const generation = this.generation;
    if (!owner) return Promise.reject(changed());
    if (this.inFlight) return this.inFlight;
    this.store.setState({ status: 'running', notice: null });
    const promise = this.queue(async () => {
      try {
        this.assertOwner(owner, generation);
        const vault = this.vaultFor(owner.userId);
        let command = await vault.read();
        this.assertOwner(owner, generation);
        if (initial) {
          if (command)
            throw new BackendError({
              code: 'CLIENT.COMMAND_PENDING',
              message: 'A saved request already exists. Retry recovery.',
            });
          await vault.write(initial);
          command = initial;
        }
        if (!command) {
          this.show(null, 'Recovery complete. Refresh the server resource before continuing.');
          return undefined;
        }
        this.assertOwner(owner, generation);
        if (
          !isLaneCommand(this.lane, command.name) ||
          command.body !== commandBody(command.name, JSON.parse(command.body))
        )
          throw new BackendError({
            code: 'CLIENT.COMMAND_STORAGE_INVALID',
            message: 'Saved request format is invalid. Check the server outcome before continuing.',
          });
        validateCommandIdentity(command.name, command.identity);
        const now = this.now();
        if (now < command.lastAttemptAt || now - command.createdAt >= 23 * 60 * 60 * 1000)
          throw new BackendError({
            code: 'CLIENT.RECONCILIATION_REQUIRED',
            message:
              'The retry window has closed. Check the server outcome; this saved request cannot be resent.',
          });
        if (now < command.retryAt)
          throw new BackendError({
            code: 'CLIENT.RETRY_LATER',
            message: 'Wait before retrying this request.',
            retryAfterSeconds: Math.ceil((command.retryAt - now) / 1000),
          });
        const wasAmbiguous = command.ambiguous;
        command = { ...command, lastAttemptAt: now, ambiguous: true };
        // Write-ahead ambiguity: a process exit at any later point cannot mint a replacement request.
        await vault.write(command);
        this.assertOwner(owner, generation);
        let result: unknown;
        try {
          const send = this.handlers[command.name] as (
            value: unknown,
            identity: IntentIdentity,
          ) => Promise<unknown>;
          result = await send(JSON.parse(command.body), command.identity);
        } catch (error) {
          if (!wasAmbiguous && definitive(error)) await vault.settle();
          else if (error instanceof BackendError && error.retryAfterSeconds !== undefined) {
            await vault.write({
              ...command,
              retryAt: Math.max(
                command.retryAt,
                Math.min(
                  command.createdAt + 23 * 60 * 60 * 1000,
                  this.now() + error.retryAfterSeconds * 1000,
                ),
              ),
            });
          }
          throw error;
        }
        // A settlement marker is committed before payload deletion. Recovery never resends a settled command.
        await vault.settle();
        this.assertOwner(owner, generation);
        this.show(null, 'Server confirmed the request. Refresh the resource to see its current state.');
        return result;
      } catch (error: unknown) {
        if (generation === this.generation) {
          try {
            const saved = await this.vaultFor(owner.userId).read();
            if (generation === this.generation)
              this.show(
                saved,
                error instanceof BackendError
                  ? error.message
                  : 'The request outcome is unknown. Retry recovery.',
              );
          } catch (storageError) {
            if (generation === this.generation) this.failure(storageError);
          }
        }
        throw error;
      }
    });
    this.inFlight = promise;
    void promise
      .finally(() => {
        if (this.inFlight === promise) this.inFlight = undefined;
      })
      .catch(() => {});
    return promise;
  }

  private show(command: SavedCommand | null, notice: string | null): void {
    this.store.setState({
      status: command ? 'pending' : 'ready',
      name: command?.name ?? null,
      createdAt: command?.createdAt ?? null,
      notice,
    });
  }
  private failure(error: unknown): void {
    this.store.setState({
      status: 'blocked',
      notice: error instanceof BackendError ? error.message : 'Unable to recover secure request storage.',
    });
  }
  private assertOwner(owner: Owner, generation: number): void {
    const current = this.currentOwner();
    if (
      generation !== this.generation ||
      current?.userId !== owner.userId ||
      current?.sessionId !== owner.sessionId
    )
      throw changed();
  }
  private queue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work);
    this.tail = next.catch(() => {});
    return next;
  }
}
