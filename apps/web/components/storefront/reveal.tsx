import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Fades and lifts its content in as it scrolls into view. Pure CSS (`.ui-reveal`, a scroll-driven animation in
 * globals.css): no JavaScript, nothing hidden before hydration, and browsers without scroll-driven animations — or a
 * reader who prefers reduced motion — simply see the content in place. `index` staggers siblings (a grid's cards). */
export function Reveal({
  children,
  className,
  style,
  index = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  index?: number;
  as?: "div" | "section" | "li";
}) {
  return (
    <Tag className={cn("ui-reveal", className)} style={{ ...style, "--reveal-i": Math.min(index, 7) } as CSSProperties}>
      {children}
    </Tag>
  );
}
