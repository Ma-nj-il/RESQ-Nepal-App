import AsyncStorage from '@react-native-async-storage/async-storage';
import { EMERGENCY_CONTACTS_KEY } from '../../constants/storage';

/**
 * Trusted emergency contacts (name + phone).
 *
 * Stored on the device only — these are personal phone numbers and are never
 * uploaded. They are used exclusively to prefill the SOS SMS composer and are
 * not a substitute for a monitored emergency service.
 */
export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relationship?: string;
}

const MAX_CONTACTS = 5;

const isValidContact = (value: unknown): value is EmergencyContact => {
  if (!value || typeof value !== 'object') return false;
  const c = value as EmergencyContact;
  return typeof c.id === 'string' && typeof c.name === 'string' && typeof c.phone === 'string';
};

export const emergencyContactsService = {
  async getAll(): Promise<EmergencyContact[]> {
    try {
      const raw = await AsyncStorage.getItem(EMERGENCY_CONTACTS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isValidContact);
    } catch {
      return [];
    }
  },

  async saveAll(contacts: EmergencyContact[]): Promise<void> {
    await AsyncStorage.setItem(EMERGENCY_CONTACTS_KEY, JSON.stringify(contacts.slice(0, MAX_CONTACTS)));
  },

  /** Adds a contact and returns the updated list. */
  async add(contact: Omit<EmergencyContact, 'id'>): Promise<EmergencyContact[]> {
    const contacts = await emergencyContactsService.getAll();
    const next = [
      ...contacts,
      { ...contact, id: `contact-${Date.now()}-${Math.floor(Math.random() * 1000)}` },
    ].slice(0, MAX_CONTACTS);
    await emergencyContactsService.saveAll(next);
    return next;
  },

  /** Updates a contact by id and returns the updated list. */
  async update(id: string, patch: Omit<EmergencyContact, 'id'>): Promise<EmergencyContact[]> {
    const contacts = await emergencyContactsService.getAll();
    const next = contacts.map((c) => (c.id === id ? { ...c, ...patch } : c));
    await emergencyContactsService.saveAll(next);
    return next;
  },

  /** Removes a contact by id and returns the updated list. */
  async remove(id: string): Promise<EmergencyContact[]> {
    const contacts = await emergencyContactsService.getAll();
    const next = contacts.filter((c) => c.id !== id);
    await emergencyContactsService.saveAll(next);
    return next;
  },
};

export const MAX_EMERGENCY_CONTACTS = MAX_CONTACTS;

/** Loose validation: enough digits to be a reachable number. */
export const isValidPhone = (phone: string): boolean => {
  const digits = phone.replace(/[^0-9]/g, '');
  return digits.length >= 7 && digits.length <= 15;
};
