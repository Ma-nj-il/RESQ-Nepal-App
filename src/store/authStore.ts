import { create } from 'zustand';
import type { User, UserMode } from '../types/index';
import { isDemoMode } from '../utils/demoMode';
import { canEnterDemoDriverMode } from '../utils/demoDriver';
import { useDriverDemoStore } from './driverDemoStore';

const DEMO_DRIVER_USER: User = {
  id: 'demo-driver-local',
  full_name: 'DEMO DRIVER',
  email: '',
  phone: '',
  mode: 'driver',
  created_at: '',
  updated_at: '',
};

interface DemoDriverReturnState {
  user: User | null;
  isAuthenticated: boolean;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  mode: UserMode;
  isDemoDriver: boolean;
  demoDriverReturnState: DemoDriverReturnState | null;
  setUser: (user: User | null) => void;
  setAuthenticated: (val: boolean) => void;
  setLoading: (val: boolean) => void;
  setMode: (mode: UserMode) => void;
  loginDemoDriver: () => boolean;
  returnToUserMode: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  mode: 'user',
  isDemoDriver: false,
  demoDriverReturnState: null,
  setUser: (user) => set({ user }),
  setAuthenticated: (isAuthenticated) => set({ isAuthenticated }),
  setLoading: (isLoading) => set({ isLoading }),
  setMode: (mode) => set({ mode }),
  loginDemoDriver: () => {
    if (!canEnterDemoDriverMode(isDemoMode())) return false;
    const state = get();
    useDriverDemoStore.getState().restart();
    set({
      user: DEMO_DRIVER_USER,
      isAuthenticated: true,
      mode: 'driver',
      isDemoDriver: true,
      demoDriverReturnState: {
        user: state.isDemoDriver ? state.demoDriverReturnState?.user ?? null : state.user,
        isAuthenticated: state.isDemoDriver
          ? state.demoDriverReturnState?.isAuthenticated ?? false
          : state.isAuthenticated,
      },
    });
    return true;
  },
  returnToUserMode: () => {
    const state = get();
    if (!state.isDemoDriver) {
      set({ mode: 'user' });
      return;
    }
    const previous = state.demoDriverReturnState;
    useDriverDemoStore.getState().restart();
    set({
      user: previous?.user ?? null,
      isAuthenticated: previous?.isAuthenticated ?? false,
      mode: 'user',
      isDemoDriver: false,
      demoDriverReturnState: null,
    });
  },
  logout: () => {
    useDriverDemoStore.getState().restart();
    set({
      user: null,
      isAuthenticated: false,
      mode: 'user',
      isDemoDriver: false,
      demoDriverReturnState: null,
    });
  },
}));
