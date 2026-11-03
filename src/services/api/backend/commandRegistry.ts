import type { IntentIdentity } from './commandIntent';
import type { createDispatchApi } from './dispatch';
import type { createRequesterApi, Preferences, Ticket } from './requester';
import { BackendError } from './errors';
import { uuid } from './decoders';

/** Persist operation names and domain inputs, never URLs, headers, tokens, or executable callbacks. */
export function createCommandHandlers(
  api: ReturnType<typeof createRequesterApi>,
  dispatch: ReturnType<typeof createDispatchApi>,
) {
  const versioned = (identity: IntentIdentity) => {
    if (!Number.isSafeInteger(identity.expectedVersion) || identity.expectedVersion! < 0)
      throw new Error('A resource version is required.');
    return { idempotencyKey: identity.idempotencyKey, expectedVersion: identity.expectedVersion! };
  };
  return {
    preferences: (value: Preferences, identity: IntentIdentity) =>
      api.replacePreferences(value, versioned(identity)),
    createTicket: (
      value: { category: Ticket['category']; message: string; tripId?: string },
      identity: IntentIdentity,
    ) => api.createTicket(value, identity.idempotencyKey),
    reply: (value: { id: string; message: string }, identity: IntentIdentity) =>
      api.reply(value.id, value.message, versioned(identity)),
    rateTrip: (value: { id: string; score: number }, identity: IntentIdentity) =>
      api.rateTrip(value.id, value.score, versioned(identity)),
    createBooking: (value: Parameters<typeof dispatch.createBooking>[0], identity: IntentIdentity) =>
      dispatch.createBooking(value, identity.idempotencyKey),
    cancelBooking: (value: { id: string; reasonCode: string; reason: string }, identity: IntentIdentity) =>
      dispatch.cancelBooking(
        value.id,
        { reasonCode: value.reasonCode, reason: value.reason },
        versioned(identity),
      ),
  };
}

export type CommandHandlers = ReturnType<typeof createCommandHandlers>;
export type CommandName = keyof CommandHandlers;
export type CommandInput<K extends CommandName> = Parameters<CommandHandlers[K]>[0];
export type CommandResult<K extends CommandName> = Awaited<ReturnType<CommandHandlers[K]>>;
export const COMMAND_LANES = {
  account: ['preferences'],
  product: ['createTicket', 'reply', 'rateTrip'],
  dispatch: ['createBooking', 'cancelBooking'],
} as const;
export type CommandLane = keyof typeof COMMAND_LANES;

export function isLaneCommand(lane: CommandLane, name: unknown): name is CommandName {
  return typeof name === 'string' && (COMMAND_LANES[lane] as readonly string[]).includes(name);
}

const fields: Record<CommandName, readonly string[]> = {
  preferences: ['bookingUpdates', 'tripUpdates', 'supportUpdates', 'marketing'],
  createTicket: ['category', 'message', 'tripId'],
  reply: ['id', 'message'],
  rateTrip: ['id', 'score'],
  cancelBooking: ['id', 'reasonCode', 'reason'],
  createBooking: [
    'serviceCategory',
    'pickupLatitude',
    'pickupLongitude',
    'destinationLatitude',
    'destinationLongitude',
    'fareQuoteId',
    'pickupGeographicUnitId',
    'destinationGeographicUnitId',
    'urgency',
    'patientName',
    'patientPhone',
    'pickupContactName',
    'pickupContactPhone',
    'assistanceNotes',
    'emergencyTransportConsent',
    'locationSharingConsent',
  ],
};

export function commandBody(name: CommandName, input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BackendError({ code: 'CLIENT.COMMAND_INVALID', message: 'Invalid request input.' });
  const value = input as Record<string, unknown>;
  const body: Record<string, string | number | boolean> = {};
  for (const key of fields[name]) {
    const item = value[key];
    if (item === undefined) continue;
    if (
      !['string', 'number', 'boolean'].includes(typeof item) ||
      (typeof item === 'number' && !Number.isFinite(item))
    ) {
      throw new BackendError({ code: 'CLIENT.COMMAND_INVALID', message: 'Invalid request input.' });
    }
    body[key] = item as string | number | boolean;
  }
  return JSON.stringify(body);
}

export function validateCommandIdentity(name: CommandName, identity: IntentIdentity): void {
  uuid(identity.idempotencyKey);
  if (
    (identity.expectedVersion !== undefined &&
      (!Number.isSafeInteger(identity.expectedVersion) ||
        identity.expectedVersion < 0 ||
        identity.expectedVersion > 2147483646)) ||
    (!['createTicket', 'createBooking'].includes(name) && identity.expectedVersion === undefined)
  ) {
    throw new BackendError({
      code: 'CLIENT.COMMAND_INVALID',
      message: 'Refresh the resource to obtain its current version.',
    });
  }
}
