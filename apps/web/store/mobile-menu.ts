import { create } from "zustand";

/** The phone menu drawer (components/storefront/mobile-nav.tsx): opened from the header's menu button and from the
 * bottom tab bar's Shop tab, so both are one drawer with one state. */
interface MobileMenuState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useMobileMenuStore = create<MobileMenuState>()((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
