import { create } from 'zustand';

interface AppState {
  selectedYear: number;
  selectedOrganisation: string | null;
  setSelectedYear: (year: number) => void;
  setSelectedOrganisation: (id: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedYear: new Date().getFullYear(),
  selectedOrganisation: null,
  setSelectedYear: (year) => set({ selectedYear: year }),
  setSelectedOrganisation: (id) => set({ selectedOrganisation: id }),
}));
