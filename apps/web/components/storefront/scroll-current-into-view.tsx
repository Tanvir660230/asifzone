"use client";

import { useEffect, useRef } from "react";

/**
 * A sideways-scrolling list whose chosen item (`aria-current`) starts in view: on a phone a product family's six colour
 * tiles don't fit, and the colour being viewed could sit cut off at the edge. Only the list scrolls, never the page.
 */
export function ScrollCurrentIntoView({ className, children, ...rest }: React.HTMLAttributes<HTMLUListElement>) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = ref.current;
    const current = list?.querySelector<HTMLElement>("[aria-current]")?.closest("li");
    if (!list || !current || list.scrollWidth <= list.clientWidth) return;
    const left = current.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft;
    const right = left + current.getBoundingClientRect().width;
    if (left >= list.scrollLeft && right <= list.scrollLeft + list.clientWidth) return;
    list.scrollLeft = Math.max(0, right - list.clientWidth + 16);
  }, []);
  return (
    <ul ref={ref} className={className} {...rest}>
      {children}
    </ul>
  );
}
