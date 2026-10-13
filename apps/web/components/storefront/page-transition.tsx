"use client";

import { type ReactNode, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { durations, easings } from "@/lib/motion";
import { clearNavigation, peekNavigation, type NavDirection } from "@/lib/nav-direction";

const PHONE = "(max-width: 1023.98px)";

// Set once the first page of the visit has shown; survives the shell remounting between layout groups.
let shellMounted = false;

/** Phones move like an iOS navigation stack: a pushed page slides in from the right while the one it leaves drifts a
 * little to the left; Back runs it the other way; a tab switch only crossfades. Larger screens keep the quiet fade. */
const phone: Variants = {
  enter: (direction: NavDirection) =>
    direction === "none" ? { opacity: 0 } : { opacity: 0, x: direction === "back" ? "-30%" : "30%" },
  center: { opacity: 1, x: 0, transition: { duration: durations.slow, ease: easings.sheet } },
  exit: (direction: NavDirection) =>
    direction === "none"
      ? { opacity: 0, transition: { duration: durations.fast, ease: easings.exit } }
      : { opacity: 0, x: direction === "back" ? "18%" : "-18%", transition: { duration: durations.base, ease: easings.exit } },
};

const wide: Variants = {
  enter: { opacity: 0, y: 6 },
  center: { opacity: 1, y: 0, transition: { duration: durations.fast, ease: easings.standard } },
  exit: { opacity: 0, y: -6, transition: { duration: durations.fast, ease: easings.standard } },
};

/** Keyed on pathname so only real route changes trigger the transition (not search-param-only updates, e.g. facet
 * filters) — AnimatePresence needs a stable key change to know something replaced. `mode="popLayout"`, not the default
 * "sync" or "wait": "wait" fully unmounts the outgoing page before the next one mounts, leaving a blank gap between them;
 * plain "sync" leaves the exiting page in document flow, so both pages' heights stack and shove the footer around during
 * the overlap. popLayout pulls the exiting page out of flow (position: absolute) the moment the next one mounts, so they
 * cross in place with no blank gap and no layout jump. */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // The account is one place with its own content fade under fixed tabs (AccountContent): moving between its sections
  // must not move the tabs too, so the whole account shares one key here.
  const key = pathname.startsWith("/account") ? "/account" : pathname;
  // A route in another layout group (home → a category page, a product → the bag) mounts a new shell, and with it this
  // component: then it is a navigation all the same, and the page that arrives still slides in. Only the very first page
  // of the visit appears without motion.
  const [arrived] = useState(() => shellMounted);
  const [isPhone, setIsPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(PHONE).matches);
  // The direction belongs to the key it was read for — derived during render, so the entering page has it at once.
  const [nav, setNav] = useState<{ key: string; direction: NavDirection }>(() => ({
    key,
    direction: arrived ? peekNavigation() : "none",
  }));
  if (nav.key !== key) setNav({ key, direction: peekNavigation() });

  useEffect(() => {
    shellMounted = true;
    clearNavigation();
  }, [key]);

  useEffect(() => {
    const query = window.matchMedia(PHONE);
    const update = () => setIsPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return (
    // Pages slide sideways on phones: nothing may scroll the page horizontally while they do.
    <div className="overflow-x-clip">
      <AnimatePresence mode="popLayout" initial={arrived} custom={nav.direction}>
        <motion.div key={key} custom={nav.direction} variants={isPhone ? phone : wide} initial="enter" animate="center" exit="exit">
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
