/**
 * Which way the next route change moves, for the phone's page transition (components/storefront/page-transition.tsx):
 * a tapped link pushes the new page in from the right, the browser's back (or a swipe back) slides it in from the left,
 * and switching tabs in the tab bar just swaps the page, the way an app's tab bar does.
 */
export type NavDirection = "forward" | "back" | "none";

// A mark only counts for the route change right after it: a back that only changed the query (filters) never reaches
// the transition, and must not turn the next tapped link into a "back".
const FRESH_MS = 1500;
let pending: { direction: NavDirection; at: number } | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => markNavigation("back"));
}

/** Say how the navigation about to happen should move (called just before it, e.g. from a tab's click). */
export function markNavigation(direction: NavDirection) {
  pending = { direction, at: Date.now() };
}

/** The direction of the route change happening now; a plain link is "forward". Doesn't consume the mark (a render may
 * run twice) — `clearNavigation` does, once the change has committed. */
export function peekNavigation(): NavDirection {
  return pending && Date.now() - pending.at < FRESH_MS ? pending.direction : "forward";
}

export function clearNavigation() {
  pending = null;
}
