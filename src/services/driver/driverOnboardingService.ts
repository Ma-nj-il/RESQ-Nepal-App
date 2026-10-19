import AsyncStorage from '@react-native-async-storage/async-storage';
import { DRIVER_APPLICATION_DRAFT_KEY } from '../../constants/storage';

export type DriverVehicleCategory = 'basic' | 'icu';

export interface DriverApplicationDraft {
  fullName: string;
  phone: string;
  licenceNumber: string;
  licenceExpiry: string;
  vehiclePlate: string;
  category: DriverVehicleCategory;
  equipment: string[];
  hospitalAffiliation: string;
  updatedAt: string;
}

export const EMPTY_DRIVER_APPLICATION: Omit<DriverApplicationDraft, 'updatedAt'> = {
  fullName: '',
  phone: '',
  licenceNumber: '',
  licenceExpiry: '',
  vehiclePlate: '',
  category: 'basic',
  equipment: [],
  hospitalAffiliation: '',
};

/**
 * Partner applications are collected on the device until the real onboarding
 * service exists. Submission must happen server-side (document storage,
 * verification, approval and an audit trail — see docs/future-api-contracts.md),
 * so this service only saves / loads / clears the draft. The screen states
 * plainly that nothing has been submitted.
 */
export const driverOnboardingService = {
  async getDraft(): Promise<DriverApplicationDraft | null> {
    try {
      const raw = await AsyncStorage.getItem(DRIVER_APPLICATION_DRAFT_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const draft = parsed as Partial<DriverApplicationDraft>;
      if (typeof draft.fullName !== 'string') return null;
      return {
        ...EMPTY_DRIVER_APPLICATION,
        ...draft,
        updatedAt: typeof draft.updatedAt === 'string' ? draft.updatedAt : new Date().toISOString(),
      };
    } catch {
      return null;
    }
  },

  async saveDraft(draft: Omit<DriverApplicationDraft, 'updatedAt'>): Promise<DriverApplicationDraft> {
    const stamped: DriverApplicationDraft = { ...draft, updatedAt: new Date().toISOString() };
    await AsyncStorage.setItem(DRIVER_APPLICATION_DRAFT_KEY, JSON.stringify(stamped));
    return stamped;
  },

  async clearDraft(): Promise<void> {
    await AsyncStorage.removeItem(DRIVER_APPLICATION_DRAFT_KEY);
  },
};
