"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * The sticky storefront header: always in view at the top of the page (navigation, search and the bag stay one tap away),
 * and it firms up its surface with a soft shadow once the page has scrolled under it. One passive scroll listener that
 * only changes state when crossing the threshold.
 */
export function HeaderShell({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <header data-scrolled={scrolled || undefined} className="ui-site-header sticky top-0 z-30">
      {children}
    </header>
  );
}
