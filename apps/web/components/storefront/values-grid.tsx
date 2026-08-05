"use client";

import { motion } from "framer-motion";
import { Feather, Ruler, Leaf, Gem } from "lucide-react";

const VALUES = [
  {
    icon: Feather,
    title: "Considered Fabric",
    description: "Natural fibers and mill-dyed cottons, chosen for how they wear over time — not just how they photograph.",
  },
  {
    icon: Ruler,
    title: "Fit & Finish",
    description: "Pattern-checked silhouettes and clean interior seams — details you feel more than see.",
  },
  {
    icon: Gem,
    title: "Timeless Design",
    description: "Pieces built around a season, not a trend cycle — worth keeping well past this year.",
  },
  {
    icon: Leaf,
    title: "Considered Sourcing",
    description: "Smaller runs, fewer offcuts, and suppliers we can actually stand behind.",
  },
];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

export function ValuesGrid({ storeName }: { storeName: string }) {
  return (
    <section className="bg-cream-100 py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <p className="mb-2 text-center text-xs uppercase tracking-[0.3em] text-brass-500">Why {storeName}</p>
        <h2 className="mb-10 text-center font-display text-2xl text-ink-900">What We Stand For</h2>
        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-6"
        >
          {VALUES.map(({ icon: Icon, title, description }) => (
            <motion.div
              key={title}
              variants={item}
              className="rounded-lg border border-ink-100 bg-cream-50 p-6 text-center shadow-sm"
            >
              <Icon className="mx-auto mb-4 text-brass-500" size={28} strokeWidth={1.5} />
              <h3 className="mb-2 text-sm uppercase tracking-wide text-ink-900">{title}</h3>
              <p className="text-xs leading-relaxed text-ink-500">{description}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
