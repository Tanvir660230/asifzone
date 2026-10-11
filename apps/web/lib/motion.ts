import type { Transition, Variants } from "framer-motion";
import tokens from "@clothing-brand/ui-tokens";

/**
 * The motion language for JS animations (Framer Motion). Same durations/easings as the CSS side
 * (`duration-base`, `ease-smooth`, … from @clothing-brand/ui-tokens), so a toast, a drawer and a
 * hover transition all move alike. Reduced motion is honoured globally by
 * <MotionConfig reducedMotion="user"> in app/providers.tsx — these presets don't need to check.
 *
 * Use motion only where it explains something: entering/leaving layers, feedback, hierarchy.
 */

const { duration, easing, spring: springTokens } = tokens.motion;
const seconds = (ms: number) => ms / 1000;

export const durations = {
  instant: seconds(duration.instant),
  fast: seconds(duration.fast),
  base: seconds(duration.base),
  slow: seconds(duration.slow),
  slower: seconds(duration.slower),
} as const;

export const easings = easing;

export const transitions = {
  /** Default for anything entering or reacting to hover/press. */
  smooth: { duration: durations.base, ease: easing.smooth } satisfies Transition,
  /** Elements leaving — faster, accelerating away. */
  exit: { duration: durations.fast, ease: easing.exit } satisfies Transition,
  /** Physical feel for small floating feedback (toasts, chips). */
  spring: { type: "spring", ...springTokens } satisfies Transition,
  /** Page-level content swaps. */
  page: { duration: durations.slow, ease: easing.smooth } satisfies Transition,
} as const;

/** Variant sets — pass as `variants` with `initial="hidden" animate="visible" exit="exit"`. */
export const variants = {
  fade: {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: transitions.smooth },
    exit: { opacity: 0, transition: transitions.exit },
  },
  /** Content rising into place (sections, page content). */
  rise: {
    hidden: { opacity: 0, y: 8 },
    visible: { opacity: 1, y: 0, transition: transitions.smooth },
    exit: { opacity: 0, y: 4, transition: transitions.exit },
  },
  /** Dialogs and floating panels. */
  scale: {
    hidden: { opacity: 0, scale: 0.96, y: 8 },
    visible: { opacity: 1, scale: 1, y: 0, transition: transitions.smooth },
    exit: { opacity: 0, scale: 0.97, transition: transitions.exit },
  },
  /** Toasts and other small notifications. */
  toast: {
    hidden: { opacity: 0, y: 16, scale: 0.95 },
    visible: { opacity: 1, y: 0, scale: 1, transition: transitions.spring },
    exit: { opacity: 0, scale: 0.95, transition: transitions.exit },
  },
  /** Route content swap (opacity only, so layout never jumps). */
  page: {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: transitions.page },
    exit: { opacity: 0, transition: transitions.exit },
  },
} as const satisfies Record<string, Variants>;
