"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { variants } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface BulkActionBarProps {
  /** Number of selected rows; the bar is hidden at 0. */
  count: number;
  /** e.g. "orders" — used in the bar's accessible name. */
  itemLabel?: string;
  children: ReactNode;
  className?: string;
}

/** Floating glass bar for actions on a table selection: appears when something is selected,
 * centered above the bottom edge on every screen size. */
export function BulkActionBar({ count, itemLabel = "items", children, className }: BulkActionBarProps) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          variants={variants.rise}
          initial="hidden"
          animate="visible"
          exit="exit"
          role="region"
          aria-label={`Actions for ${count} selected ${itemLabel}`}
          data-hide-on-keyboard=""
          className={cn(
            "glass-panel fixed inset-x-0 bottom-4 z-dock mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-2xl px-4 py-3 text-sm",
            className,
          )}
        >
          <span className="flex items-center gap-1.5 font-medium text-ink-800">
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-fg">
              {count}
            </span>
            selected
          </span>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
