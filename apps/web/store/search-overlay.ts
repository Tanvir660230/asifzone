import { create } from "zustand";

interface SearchOverlayState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useSearchOverlayStore = create<SearchOverlayState>()((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
