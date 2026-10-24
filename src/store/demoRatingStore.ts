import { create } from 'zustand';

export interface DemoRatingRecord {
  rating: number;
  feedback?: string;
  submittedAt: string;
}

interface DemoRatingState {
  ratingsByTripId: Record<string, DemoRatingRecord>;
  saveDemoRating: (tripId: string, record: DemoRatingRecord) => boolean;
}

export const useDemoRatingStore = create<DemoRatingState>((set, get) => ({
  ratingsByTripId: {},
  saveDemoRating: (tripId, record) => {
    if (get().ratingsByTripId[tripId]) return false;
    set((state) => ({
      ratingsByTripId: { ...state.ratingsByTripId, [tripId]: record },
    }));
    return true;
  },
}));
