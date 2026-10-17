import { create } from 'zustand';
import { PaymentMethod } from '../types';

export interface WalletTransaction {
  id: string;
  type: 'topup' | 'payment' | 'refund' | 'tip';
  amount: number;
  method: PaymentMethod;
  date: string;
  status: 'completed' | 'pending' | 'failed';
  description?: string;
}

interface WalletState {
  balance: number;
  transactions: WalletTransaction[];
  selectedMethod: PaymentMethod;
  setBalance: (balance: number) => void;
  topUp: (amount: number) => void;
  deduct: (amount: number) => void;
  setSelectedMethod: (method: PaymentMethod) => void;
  addTransaction: (transaction: WalletTransaction) => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  balance: 2069.5,
  transactions: [
    {
      id: 'trx-001',
      type: 'topup',
      amount: 2500,
      method: 'esewa',
      date: '2025-12-22T09:42:00Z',
      status: 'completed',
      description: 'Top Up',
    },
    {
      id: 'trx-002',
      type: 'topup',
      amount: 1250,
      method: 'khalti',
      date: '2025-12-16T10:06:00Z',
      status: 'completed',
      description: 'Top Up',
    },
    {
      id: 'trx-003',
      type: 'topup',
      amount: 500,
      method: 'card',
      date: '2025-12-12T18:28:00Z',
      status: 'completed',
      description: 'Top Up',
    },
  ],
  selectedMethod: 'wallet',
  setBalance: (balance) => set({ balance }),
  topUp: (amount) =>
    set((state) => ({
      balance: state.balance + amount,
      transactions: [
        {
          id: `trx-${Date.now()}`,
          type: 'topup',
          amount,
          method: state.selectedMethod,
          date: new Date().toISOString(),
          status: 'completed',
          description: 'Top Up',
        },
        ...state.transactions,
      ],
    })),
  deduct: (amount) => set((state) => ({ balance: Math.max(0, state.balance - amount) })),
  setSelectedMethod: (selectedMethod) => set({ selectedMethod }),
  addTransaction: (transaction) =>
    set((state) => ({ transactions: [transaction, ...state.transactions] })),
}));
