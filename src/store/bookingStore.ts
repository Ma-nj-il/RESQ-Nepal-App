import { create } from 'zustand';
import { Booking, AmbulanceCategory, BookingStatus, RoutePoint } from '../types';

interface BookingState {
  currentBooking: Booking | null;
  pickup: RoutePoint | null;
  destination: RoutePoint | null;
  selectedCategory: AmbulanceCategory;
  bookingStatus: BookingStatus;
  isProcessing: boolean;
  setPickup: (p: RoutePoint | null) => void;
  setDestination: (d: RoutePoint | null) => void;
  setCategory: (c: AmbulanceCategory) => void;
  setBooking: (b: Booking | null) => void;
  setBookingStatus: (s: BookingStatus) => void;
  setProcessing: (v: boolean) => void;
  reset: () => void;
}

export const useBookingStore = create<BookingState>((set) => ({
  currentBooking: null,
  pickup: null,
  destination: null,
  selectedCategory: 'basic',
  bookingStatus: 'draft',
  isProcessing: false,
  setPickup: (pickup) => set({ pickup }),
  setDestination: (destination) => set({ destination }),
  setCategory: (selectedCategory) => set({ selectedCategory }),
  setBooking: (currentBooking) => set({ currentBooking }),
  setBookingStatus: (bookingStatus) => set({ bookingStatus }),
  setProcessing: (isProcessing) => set({ isProcessing }),
  reset: () => set({ currentBooking: null, pickup: null, destination: null, selectedCategory: 'basic', bookingStatus: 'draft', isProcessing: false }),
}));
