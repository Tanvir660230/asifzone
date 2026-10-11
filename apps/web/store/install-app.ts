import { create } from "zustand";

/** Chrome/Edge/Samsung Internet's install offer, held back (preventDefault) so the store can make it at a fitting moment
 * instead of the browser's own mini-bar. Not in the DOM typings yet. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallAppState {
  /** The held install offer; null when the browser hasn't made one (already installed, unsupported, iOS). */
  deferred: BeforeInstallPromptEvent | null;
  installed: boolean;
  setDeferred: (event: BeforeInstallPromptEvent | null) => void;
  markInstalled: () => void;
}

export const useInstallAppStore = create<InstallAppState>()((set) => ({
  deferred: null,
  installed: false,
  setDeferred: (deferred) => set({ deferred }),
  markInstalled: () => set({ installed: true, deferred: null }),
}));
