const nepalMobile = /^\+9779[678]\d{8}$/;
const internationalPhone = /^\+[1-9]\d{7,14}$/;

export class InvalidPhoneNumberError extends Error {
  constructor() {
    super('Phone number is not a valid E.164 number');
    this.name = 'InvalidPhoneNumberError';
  }
}

export function normalizePhoneNumber(value: string): string {
  const compact = value.trim().replace(/[\s()-]/g, '');
  let normalized = compact;
  if (/^0?9[678]\d{8}$/.test(compact)) {
    normalized = `+977${compact.replace(/^0/, '')}`;
  } else if (/^9779[678]\d{8}$/.test(compact)) {
    normalized = `+${compact}`;
  }

  if (!internationalPhone.test(normalized)) throw new InvalidPhoneNumberError();
  if (normalized.startsWith('+977') && !nepalMobile.test(normalized)) {
    throw new InvalidPhoneNumberError();
  }
  return normalized;
}

export function maskPhoneNumber(value: string): string {
  if (value.length < 6) return '***';
  return `${value.slice(0, 4)}*****${value.slice(-3)}`;
}
