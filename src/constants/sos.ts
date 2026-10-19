/**
 * SOS configuration.
 *
 * The emergency SMS recipient is intentionally NOT hardcoded — RESQ Nepal does
 * not invent an emergency number. It is configured per environment:
 *
 *   EXPO_PUBLIC_SOS_SMS_NUMBER=+977XXXXXXXXXX
 *
 * When it is empty (the default), the SOS screen still records the event
 * locally but the "Send SMS" action is disabled with a clear explanation.
 */
export const SOS_SMS_RECIPIENT = (process.env.EXPO_PUBLIC_SOS_SMS_NUMBER || '').trim();

/** How long the three taps stay "armed" before the progress resets. */
export const SOS_TAPS_REQUIRED = 3;
export const SOS_TAP_WINDOW_MS = 5000;
