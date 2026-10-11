"use client";

import { motion } from "framer-motion";
import { DEFAULT_VALUES_GRID_ITEMS } from "@clothing-brand/shared";
import { resolveHomepageIcon } from "@/lib/homepage-icons";

export interface ValuesGridItem {
  icon: string;
  title: string;
  description: string;
}

const DEFAULT_VALUES: ValuesGridItem[] = [...DEFAULT_VALUES_GRID_ITEMS];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

interface ValuesGridProps {
  storeName: string;
  eyebrow?: string | null;
  heading?: string | null;
  items?: ValuesGridItem[];
}

export function ValuesGrid({ storeName, eyebrow, heading, items = DEFAULT_VALUES }: ValuesGridProps) {
  return (
    <section className="bg-cream-100 py-[calc(4rem*var(--section-rhythm))]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <p className="mb-2 text-center text-xs ui-eyebrow text-brass-500">{eyebrow || `Why ${storeName}`}</p>
        <h2 className="ui-section-heading mb-10 text-center font-display text-ink-900">{heading || "What We Stand For"}</h2>
        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-4"
        >
          {items.map(({ icon, title, description }) => {
            const Icon = resolveHomepageIcon(icon);
            return (
              <motion.div
                key={title}
                variants={item}
                className="ui-panel rounded-lg bg-cream-50 p-6 text-center"
              >
                <Icon className="mx-auto mb-4 text-brass-500" size={28} strokeWidth={1.5} aria-hidden="true" />
                <h3 className="mb-2 text-sm ui-caps text-ink-900">{title}</h3>
                <p className="text-xs leading-relaxed text-ink-500">{description}</p>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
