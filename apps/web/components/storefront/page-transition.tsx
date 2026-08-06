"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";

/** Keyed on pathname so only real route changes trigger the fade (not search-param-only updates,
 * e.g. facet filters) — AnimatePresence needs a stable key change to know something replaced.
 * `mode="popLayout"`, not the default "sync" or "wait": "wait" fully unmounts the outgoing page
 * before the next one mounts, leaving a blank gap between them; plain "sync" crossfades but leaves
 * the exiting page in document flow, so both pages' heights stack and shove the footer around
 * during the overlap. popLayout pulls the exiting page out of flow (position: absolute) the moment
 * the next one mounts, so they crossfade in place with no blank gap and no layout jump. */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.13, ease: [0.4, 0, 0.2, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
