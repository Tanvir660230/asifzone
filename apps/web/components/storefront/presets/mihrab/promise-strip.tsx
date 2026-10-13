"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const ROTATE_MS = 4000;

/**
 * The navy strip of delivery promises. From 768px every promise sits on one line; a phone has room for one, so they take
 * turns (a soft fade every few seconds). With reduced motion the first one simply stays.
 */
export function MihrabPromiseStrip({ promises }: { promises: string[] }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (promises.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setActive((index) => (index + 1) % promises.length), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [promises.length]);

  return (
    <div data-promise-strip className="bg-ink-950 text-cream-100">
      <ul className="mx-auto grid h-9 max-w-7xl items-center px-4 text-xs sm:px-6 md:flex md:justify-center md:gap-10 lg:px-8">
        {promises.map((promise, index) => (
          <li
            key={promise}
            className={cn(
              // Phones: every promise in the same grid cell, only the active one visible.
              "col-start-1 row-start-1 text-center transition-opacity duration-500 ease-smooth md:opacity-100",
              index === active ? "opacity-100" : "opacity-0",
            )}
          >
            {promise}
          </li>
        ))}
      </ul>
    </div>
  );
}
