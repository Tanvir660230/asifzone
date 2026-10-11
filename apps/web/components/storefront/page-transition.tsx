"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { durations, easings } from "@/lib/motion";

/** Keyed on pathname so only real route changes trigger the fade (not search-param-only updates,
 * e.g. facet filters) — AnimatePresence needs a stable key change to know something replaced.
 * `mode="popLayout"`, not the default "sync" or "wait": "wait" fully unmounts the outgoing page
 * before the next one mounts, leaving a blank gap between them; plain "sync" crossfades but leaves
 * the exiting page in document flow, so both pages' heights stack and shove the footer around
 * during the overlap. popLayout pulls the exiting page out of flow (position: absolute) the moment
 * the next one mounts, so they crossfade in place with no blank gap and no layout jump. */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // The account is one place with its own content fade under fixed tabs (AccountContent): moving between its sections
  // must not fade the tabs too, so the whole account shares one key here.
  const key = pathname.startsWith("/account") ? "/account" : pathname;

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={key}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: durations.fast, ease: easings.standard }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
