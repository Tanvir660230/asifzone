"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { variants } from "@/lib/motion";

/** The account's content area. A soft fade on every page change (opacity only, so nothing shifts) is what makes moving
 * between sections feel like one place changing rather than a new page loading. */
export function AccountContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <motion.div key={pathname} variants={variants.page} initial="hidden" animate="visible" className="min-w-0 pt-8 sm:pt-10">
      {children}
    </motion.div>
  );
}
