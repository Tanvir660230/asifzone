import { useCartDrawerStore } from "./cart-drawer";
import { useMobileMenuStore } from "./mobile-menu";
import { useSearchOverlayStore } from "./search-overlay";

/** Fired on window for panels that keep their open state locally (the phone filters sheet) — they close on it. */
export const CLOSE_PANELS_EVENT = "storefront:close-panels";

/** Closes every panel the phone tab bar can sit under (menu, bag, search, filters). The tab bar stays in view while
 * one is open, so a tap on any of its tabs first clears whatever is open — one panel at a time, never stacked. */
export function closeStorefrontPanels() {
  useMobileMenuStore.getState().close();
  useCartDrawerStore.getState().close();
  useSearchOverlayStore.getState().close();
  window.dispatchEvent(new Event(CLOSE_PANELS_EVENT));
}
