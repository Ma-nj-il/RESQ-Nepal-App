import { create } from 'zustand';

/**
 * In-memory store for the Driver Mode demo walkthrough.
 *
 * Active only in demo/sample builds (`EXPO_PUBLIC_DEMO_MODE=true`) or when no
 * database is configured — i.e. developer/tester sessions, never production.
 * It lets a tester walk the full driver journey (online → sample request →
 * accept → pickup → trip → completion → restart) without touching the real
 * database: nothing here is ever written anywhere, and every value is local
 * fictional data.
 *
 * The state lives for the current app session only (plain module state, no
 * persistence), so a reload returns to a clean walkthrough.
 */

export type DriverDemoCategory = 'basic' | 'icu';
export type DriverDemoPhase =
  | 'pickup'
  | 'arrived'
  | 'started'
  | 'hospital-arrived'
  | 'completed';
export type DriverDemoEmergencyLevel = 'low' | 'medium' | 'high';

export interface DriverDemoRequest {
  id: string;
  category: DriverDemoCategory;
  patientName: string;
  patientAge: string;
  patientCondition: string;
  emergencyLevel: DriverDemoEmergencyLevel;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  destinationAddress: string;
  destLat: number;
  destLng: number;
  distanceKm: number;
  durationMin: number;
  estimatedFare: number;
}

export interface DriverDemoActiveTrip extends DriverDemoRequest {
  phase: DriverDemoPhase;
}

/**
 * Two fictional sample requests — one ICU, one Patient Delivery (basic) —
 * so both categories can be exercised in the walkthrough. Names, addresses
 * and conditions are made up for the demo.
 */
const INITIAL_REQUESTS: DriverDemoRequest[] = [
  {
    id: 'demo-req-icu',
    category: 'icu',
    patientName: 'Ram Bahadur Thapa',
    patientAge: '65',
    patientCondition: 'Chest pain, needs ICU transport',
    emergencyLevel: 'high',
    pickupAddress: 'Thamel, Kathmandu',
    pickupLat: 27.7172,
    pickupLng: 85.324,
    destinationAddress: 'Norvic International Hospital, Kathmandu',
    destLat: 27.7245,
    destLng: 85.3128,
    distanceKm: 4.2,
    durationMin: 18,
    estimatedFare: 2500,
  },
  {
    id: 'demo-req-basic',
    category: 'basic',
    patientName: 'Sunita Sharma',
    patientAge: '32',
    patientCondition: 'Fracture — left leg',
    emergencyLevel: 'medium',
    pickupAddress: 'Boudha, Kathmandu',
    pickupLat: 27.7215,
    pickupLng: 85.3624,
    destinationAddress: 'Grande International Hospital, Dhapasi',
    destLat: 27.7489,
    destLng: 85.3256,
    distanceKm: 6.5,
    durationMin: 25,
    estimatedFare: 1200,
  },
];

interface DriverDemoState {
  /** Whether the walkthrough is "online" — session state, nothing real. */
  isOnline: boolean;
  /** Sample requests still waiting for a decision in this session. */
  requests: DriverDemoRequest[];
  /** The sample trip currently in progress, if any. */
  activeTrip: DriverDemoActiveTrip | null;
  /** How many sample trips were completed in this session. */
  completedTrips: number;
  /** Sets the walkthrough online state (session only). */
  setOnline: (value: boolean) => void;
  /**
   * Accept a sample request: removes it from the list and starts the trip.
   * Returns false when there is no such request or a trip is already active,
   * so the caller can explain instead of silently doing nothing.
   */
  acceptRequest: (id: string) => boolean;
  /** Declines a sample request — removes it from this session's list only. */
  declineRequest: (id: string) => void;
  /** Moves the active sample trip to the next phase. */
  setPhase: (phase: DriverDemoPhase) => void;
  /** Ends the active sample trip and counts it as completed. */
  completeActiveTrip: () => void;
  /** Resets the walkthrough: fresh requests, no active trip. */
  restart: () => void;
}

const freshWalkthrough = () => ({
  requests: INITIAL_REQUESTS.map((request) => ({ ...request })),
  activeTrip: null as DriverDemoActiveTrip | null,
  completedTrips: 0,
});

export const useDriverDemoStore = create<DriverDemoState>((set, get) => ({
  isOnline: false,
  ...freshWalkthrough(),

  setOnline: (value) => set({ isOnline: value }),

  acceptRequest: (id) => {
    const state = get();
    if (state.activeTrip) return false;
    const request = state.requests.find((r) => r.id === id);
    if (!request) return false;
    set({
      requests: state.requests.filter((r) => r.id !== id),
      activeTrip: { ...request, phase: 'pickup' },
    });
    return true;
  },

  declineRequest: (id) =>
    set((state) => ({ requests: state.requests.filter((r) => r.id !== id) })),

  setPhase: (phase) =>
    set((state) =>
      state.activeTrip ? { activeTrip: { ...state.activeTrip, phase } } : {},
    ),

  completeActiveTrip: () =>
    set((state) =>
      state.activeTrip
        ? { activeTrip: null, completedTrips: state.completedTrips + 1 }
        : {},
    ),

  restart: () => set({ isOnline: false, ...freshWalkthrough() }),
}));
