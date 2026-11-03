import { invalidResponse } from './errors';

export type Decoder<T> = (value: unknown) => T;

export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalidResponse();
  return value as Record<string, unknown>;
}

export const text: Decoder<string> = (value) => {
  if (typeof value !== 'string') invalidResponse();
  return value;
};

export const boolean: Decoder<boolean> = (value) => {
  if (typeof value !== 'boolean') invalidResponse();
  return value;
};

export function integer(minimum: number, maximum = 2147483647): Decoder<number> {
  return (value) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
      invalidResponse();
    }
    return value;
  };
}

export function oneOf<const T extends readonly string[]>(values: T): Decoder<T[number]> {
  return (value) => {
    if (typeof value !== 'string' || !values.includes(value)) invalidResponse();
    return value as T[number];
  };
}

export function nullable<T>(decode: Decoder<T>): Decoder<T | null> {
  return (value) => value === null ? null : decode(value);
}

export function optional<T>(decode: Decoder<T>): Decoder<T | undefined> {
  return (value) => value === undefined ? undefined : decode(value);
}

export function number(minimum: number, maximum: number): Decoder<number> {
  return (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) invalidResponse();
    return value;
  };
}

export function cursorPage<T>(decode: Decoder<T>) {
  return object({ items: array(decode, 50), nextCursor: nullable(uuid) });
}

/** Timeline endpoints expose a per-aggregate window without a continuation token. */
export function windowPage<T>(decode: Decoder<T>, maximum: number) {
  return object({ items: array(decode, maximum), nextCursor: (value: unknown): null => {
    if (value !== null) invalidResponse();
    return null;
  } });
}

export function object<T extends Record<string, Decoder<unknown>>>(shape: T) {
  return (value: unknown): { [K in keyof T]: ReturnType<T[K]> } => {
    const input = record(value);
    return Object.fromEntries(Object.entries(shape).map(([key, decode]) => [key, decode(input[key])])) as {
      [K in keyof T]: ReturnType<T[K]>;
    };
  };
}

export function array<T>(decode: Decoder<T>, maximum: number): Decoder<T[]> {
  return (value) => {
    if (!Array.isArray(value) || value.length > maximum) invalidResponse();
    return value.map(decode);
  };
}

export const uuid: Decoder<string> = (value) => {
  const result = text(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result)) invalidResponse();
  return result;
};

export const timestamp: Decoder<string> = (value) => {
  const result = text(value);
  // PostgreSQL JSON uses +00:00; application projections use Z.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result) ||
      !Number.isFinite(Date.parse(result))) invalidResponse();
  return result;
};

/** Preserve PostgreSQL bigint precision. Never coerce a JSON number into money. */
export const amountMinor: Decoder<string> = (value) => {
  const result = text(value);
  if (!/^(0|[1-9][0-9]{0,18})$/.test(result) ||
      (result.length === 19 && result > '9223372036854775807')) invalidResponse();
  return result;
};

export const money = object({ amountMinor, currency: oneOf(['NPR']) });

export function formatNprMinor(value: string): string {
  const digits = amountMinor(value).padStart(3, '0');
  return `NPR ${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export const bookingStatus = oneOf([
  'REQUESTED', 'SEARCHING', 'PROVIDER_ACCEPTED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'UNFULFILLED',
]);
export const tripStatus = oneOf([
  'ASSIGNED', 'PREPARING_TO_DEPART', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP',
  'PATIENT_ON_BOARD', 'EN_ROUTE_TO_DESTINATION', 'ARRIVED_AT_DESTINATION', 'COMPLETED', 'CANCELLED',
]);
export type BookingStatus = ReturnType<typeof bookingStatus>;
export type TripStatus = ReturnType<typeof tripStatus>;

export function page<T>(decode: Decoder<T>) {
  return object({ items: array(decode, 50), nextAfterId: nullable(uuid) });
}

const token: Decoder<string> = (value) => {
  const result = text(value);
  if (!/^[A-Za-z0-9._~-]+$/.test(result)) invalidResponse();
  return result;
};

const refreshToken: Decoder<string> = (value) => {
  const result = token(value);
  if (result.length < 32 || result.length > 256) invalidResponse();
  return result;
};

export const refreshCredentials = object({
  userId: uuid,
  sessionId: uuid,
  refreshToken,
  refreshTokenExpiresAt: timestamp,
});
export type RefreshCredentials = ReturnType<typeof refreshCredentials>;

export const mobileSession = object({
  userId: uuid,
  sessionId: uuid,
  assurance: oneOf(['AAL1', 'AAL2']),
  accessToken: token,
  accessTokenExpiresAt: timestamp,
  refreshToken,
  refreshTokenExpiresAt: timestamp,
});
export type MobileSession = ReturnType<typeof mobileSession>;

export const otpChallenge = object({
  challengeId: uuid,
  expiresAt: timestamp,
  deliveryState: oneOf(['ACCEPTED']),
});

export const noContent: Decoder<void> = (value) => {
  if (value !== undefined) invalidResponse();
};

export const mfaChallenge = object({ challengeId: uuid, expiresAt: timestamp, nextStep: oneOf(['TOTP']) });
