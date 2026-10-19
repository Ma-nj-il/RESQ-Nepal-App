/**
 * Native dialer helpers for the assigned-driver call action.
 *
 * The app deliberately does not place calls itself: it hands a `tel:` URL to
 * the operating system, which opens the device's own dialer so the patient
 * confirms the call and chooses their SIM on dual-SIM devices. No phone-call
 * permission is requested (the dialer route needs none), and the number is
 * never rendered as visible text in the UI — it is only passed to the
 * platform.
 *
 * `openNativeDialer` takes the platform's URL opener as a parameter so its
 * behaviour can be tested without a device (the app passes `Linking.openURL`).
 */

export type OpenUrlFn = (url: string) => Promise<unknown>;

/** Result of the dialer hand-off. */
export type DialerResult = 'opened' | 'invalid' | 'failed';

/**
 * Keeps a single leading '+' plus digits; returns null when the input cannot
 * be a dialable number (7–15 digits, per ITU E.164).
 */
export const toDialableNumber = (raw: string | null | undefined): string | null => {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return hasPlus ? `+${digits}` : digits;
};

/** Builds the platform URL that opens the native dialer, or null. */
export const buildTelUrl = (raw: string | null | undefined): string | null => {
  const number = toDialableNumber(raw);
  return number ? `tel:${number}` : null;
};

/**
 * Opens the device dialer with `raw` through the supplied URL opener.
 *
 * - `'opened'`  — the platform accepted the `tel:` URL (the patient still
 *                 confirms the call in the dialer; nothing is dialled silently)
 * - `'invalid'` — no dialable number was available; nothing was opened
 * - `'failed'`  — the platform refused to open the dialer
 */
export const openNativeDialer = async (
  raw: string | null | undefined,
  openUrl: OpenUrlFn,
): Promise<DialerResult> => {
  const url = buildTelUrl(raw);
  if (!url) return 'invalid';
  try {
    await openUrl(url);
    return 'opened';
  } catch {
    return 'failed';
  }
};
