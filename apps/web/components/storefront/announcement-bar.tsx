"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import type { Banner } from "@clothing-brand/shared";

const ROTATE_MS = 5000;
const DEFAULT_MESSAGE = "Cash on Delivery available nationwide · bKash, Nagad & card payments accepted";

export function AnnouncementBar({ announcements }: { announcements: Banner[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (announcements.length <= 1) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % announcements.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [announcements.length]);

  const current = announcements[index];
  const message = current?.title ?? current?.subtitle ?? DEFAULT_MESSAGE;

  const content = (
    <AnimatePresence mode="wait">
      <motion.span
        key={current?.id ?? "default"}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 6 }}
        transition={{ duration: 0.35 }}
        className="block"
      >
        {message}
      </motion.span>
    </AnimatePresence>
  );

  return (
    <div className="bg-ink-900 py-2 text-center text-xs uppercase tracking-wide text-cream-100">
      {current?.linkUrl ? (
        <Link href={current.linkUrl} className="hover:text-brass-300">
          {content}
        </Link>
      ) : (
        content
      )}
    </div>
  );
}
