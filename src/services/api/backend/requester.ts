import { array, boolean, integer, money, nullable, object, oneOf, page, text, timestamp, uuid } from './decoders';
import type { BackendSession } from './session';
import { invalidResponse } from './errors';

export const profile = object({
  id: uuid, status: oneOf(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
  displayName: nullable(text), phoneMasked: nullable(text), locale: text,
  version: integer(1), createdAt: timestamp, updatedAt: timestamp,
});

export const preferences = object({
  bookingUpdates: boolean, tripUpdates: boolean, supportUpdates: boolean, marketing: boolean,
  version: integer(0),
});
export type Preferences = Omit<ReturnType<typeof preferences>, 'version'>;

export const ticket = object({
  id: uuid, tripId: nullable(uuid), category: oneOf(['SERVICE', 'BILLING', 'ACCOUNT', 'OTHER']),
  status: oneOf(['OPEN', 'IN_PROGRESS', 'RESOLVED']), version: integer(1),
  resolutionCode: nullable(text), createdAt: timestamp, updatedAt: timestamp,
});
export type Ticket = ReturnType<typeof ticket>;

export const message = object({
  id: uuid, ticketId: uuid, authorUserId: uuid, message: text, createdAt: timestamp,
});

export const notification = object({
  id: uuid, kind: oneOf(['SUPPORT_UPDATED', 'CASH_RECORDED']), resourceId: uuid,
  resourceVersion: integer(1), read: boolean, createdAt: timestamp,
});

export const receipt = object({
  tripId: uuid, bookingId: uuid, fare: money, fareProvenance: text,
  paymentMethod: oneOf(['CASH']), collectionStatus: oneOf(['UNRECORDED', 'RECORDED']),
  collectionId: nullable(uuid), completedAt: timestamp, version: integer(1),
});

export interface CommandIdentity {
  /** Retain for the same user intent, including after an ambiguous network failure. */
  idempotencyKey: string;
  expectedVersion: number;
}

/** Canonical self-scoped endpoints. Ownership is resolved by the server, never a user-ID parameter. */
export function createRequesterApi(session: BackendSession) {
  return {
    profile: () => session.request({ path: '/api/v1/me', decode: profile }),
    accessContexts: () => session.request({ path: '/api/v1/me/access-contexts', decode: object({
      tenantAssignments: array(object({ assignmentId: uuid, tenantId: uuid, tenantName: text,
        profileId: uuid, profileName: text, profileVersion: integer(1), scopeType: oneOf(['TENANT', 'FACILITY_SET']),
        facilityIds: array(uuid, 1000), validUntil: timestamp }), 1000),
      authorityGrants: array(object({ grantId: uuid, level: oneOf(['PROVINCE', 'PLATFORM']), purpose: text, expiresAt: timestamp }), 1000),
    }) }),
    preferences: () => session.request({ path: '/api/v1/me/notification-preferences', decode: preferences }),
    replacePreferences: (value: Preferences, command: CommandIdentity) => session.request({
      path: '/api/v1/me/notification-preferences', method: 'PUT', decode: preferences,
      body: {
        bookingUpdates: value.bookingUpdates, tripUpdates: value.tripUpdates,
        supportUpdates: value.supportUpdates, marketing: value.marketing,
      },
      idempotencyKey: command.idempotencyKey, expectedVersion: command.expectedVersion,
    }),
    rateTrip: (tripId: string, score: number, command: CommandIdentity) => session.request({
      path: `/api/v1/trips/${uuid(tripId)}/ratings`, method: 'POST',
      decode: object({ id: uuid, tripId: uuid, score: integer(1, 5), version: integer(1) }),
      body: { score }, idempotencyKey: command.idempotencyKey, expectedVersion: command.expectedVersion,
    }),
    receipt: (tripId: string) => session.request({
      path: `/api/v1/trips/${uuid(tripId)}/receipt`, decode: receipt,
    }),
    createTicket: (value: { category: Ticket['category']; message: string; tripId?: string }, idempotencyKey: string) => session.request({
      path: '/api/v1/support/tickets', method: 'POST', decode: ticket, idempotencyKey,
      body: { category: value.category, message: value.message, ...(value.tripId === undefined ? {} : { tripId: uuid(value.tripId) }) },
    }),
    tickets: (afterId?: string) => session.request({
      path: '/api/v1/support/tickets', decode: page(ticket),
      query: { afterId: afterId === undefined ? undefined : uuid(afterId) },
    }),
    ticket: (ticketId: string) => session.request({ path: `/api/v1/support/tickets/${uuid(ticketId)}`, decode: ticket }),
    messages: (ticketId: string, afterId?: string) => session.request({
      path: `/api/v1/support/tickets/${uuid(ticketId)}/messages`, decode: page(message),
      query: { afterId: afterId === undefined ? undefined : uuid(afterId) },
    }),
    reply: (ticketId: string, text: string, command: CommandIdentity) => session.request({
      path: `/api/v1/support/tickets/${uuid(ticketId)}/messages`, method: 'POST',
      decode: object({ id: uuid, ticketId: uuid, version: integer(1) }), body: { message: text },
      idempotencyKey: command.idempotencyKey, expectedVersion: command.expectedVersion,
    }),
    notifications: (afterId?: string) => session.request({
      path: '/api/v1/me/notifications', decode: page(notification),
      query: { afterId: afterId === undefined ? undefined : uuid(afterId) },
    }),
    markRead: (notificationId: string) => session.request({
      path: `/api/v1/me/notifications/${uuid(notificationId)}/read`, method: 'PUT',
      decode: object({ id: uuid, read: (value: unknown): true => {
        if (boolean(value) !== true) invalidResponse();
        return true;
      } }),
    }),
  };
}
