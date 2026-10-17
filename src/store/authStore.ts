import { create } from 'zustand';
import { User, UserMode } from '../types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  mode: UserMode;
  setUser: (user: User | null) => void;
  setAuthenticated: (val: boolean) => void;
  setLoading: (val: boolean) => void;
  setMode: (mode: UserMode) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  mode: 'user',
  setUser: (user) => set({ user }),
  setAuthenticated: (isAuthenticated) => set({ isAuthenticated }),
  setLoading: (isLoading) => set({ isLoading }),
  setMode: (mode) => set({ mode }),
  logout: () => set({ user: null, isAuthenticated: false, mode: 'user' }),
}));
