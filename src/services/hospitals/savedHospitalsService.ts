import AsyncStorage from '@react-native-async-storage/async-storage';
import { SAVED_HOSPITALS_KEY } from '../../constants/storage';
import { Hospital } from '../../types';

/**
 * A snapshot of a hospital the user saved to this device. The directory
 * itself lives in the database (public read-only, admin-managed); this list
 * only remembers which rows were starred, so saved details can go stale —
 * the screen says so.
 *
 * There is no per-user saved_hospitals table yet (see
 * docs/future-api-contracts.md), so this list is intentionally device-local.
 */
export interface SavedHospital {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  saved_at: string;
}

export const MAX_SAVED_HOSPITALS = 20;

const isSavedHospital = (value: unknown): value is SavedHospital => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.name === 'string' && typeof v.address === 'string';
};

const readAll = async (): Promise<SavedHospital[]> => {
  try {
    const raw = await AsyncStorage.getItem(SAVED_HOSPITALS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedHospital);
  } catch {
    // A corrupted local list must never crash a screen.
    return [];
  }
};

const writeAll = async (hospitals: SavedHospital[]): Promise<void> => {
  await AsyncStorage.setItem(SAVED_HOSPITALS_KEY, JSON.stringify(hospitals));
};

export const savedHospitalsService = {
  list: readAll,

  async save(hospital: Hospital): Promise<SavedHospital[]> {
    const list = await readAll();
    if (list.some((item) => item.id === hospital.id)) return list;
    if (list.length >= MAX_SAVED_HOSPITALS) {
      throw new Error(`You can save up to ${MAX_SAVED_HOSPITALS} hospitals on this device.`);
    }
    const entry: SavedHospital = {
      id: hospital.id,
      name: hospital.name,
      address: hospital.address,
      phone: hospital.phone ?? null,
      lat: typeof hospital.lat === 'number' ? hospital.lat : null,
      lng: typeof hospital.lng === 'number' ? hospital.lng : null,
      saved_at: new Date().toISOString(),
    };
    const next = [...list, entry];
    await writeAll(next);
    return next;
  },

  async remove(id: string): Promise<SavedHospital[]> {
    const list = await readAll();
    const next = list.filter((item) => item.id !== id);
    await writeAll(next);
    return next;
  },
};
