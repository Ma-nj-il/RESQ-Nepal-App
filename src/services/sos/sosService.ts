import AsyncStorage from '@react-native-async-storage/async-storage';
import { SosDeliveryStatus, SosEvent } from '../../types';

const STORAGE_KEY = 'resq.sos.queue.v1';
const MAX_EVENTS = 20;

/**
 * Local SOS event queue.
 *
 * Events are stored on the device only. There is no dispatch backend in this
 * build, so an event can be "queued" (recorded locally) or "sms_opened" (the
 * user opened the native SMS composer). The app never claims an SMS was
 * delivered — only the OS messaging app can confirm that.
 */
async function readQueue(): Promise<SosEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SosEvent[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(events: SosEvent[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(0, MAX_EVENTS)));
  } catch {
    // Best-effort local persistence; a failed write must not break the screen.
  }
}

export const sosService = {
  async getQueue(): Promise<SosEvent[]> {
    return readQueue();
  },

  async addEvent(event: SosEvent): Promise<void> {
    const events = await readQueue();
    await writeQueue([event, ...events]);
  },

  async updateDeliveryStatus(id: string, status: SosDeliveryStatus): Promise<SosEvent | null> {
    const events = await readQueue();
    let updated: SosEvent | null = null;
    const next = events.map((event) => {
      if (event.id !== id) return event;
      updated = { ...event, delivery_status: status };
      return updated;
    });
    await writeQueue(next);
    return updated;
  },

  async clear(): Promise<void> {
    await writeQueue([]);
  },
};
