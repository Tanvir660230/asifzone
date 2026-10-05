"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TooltipProps {
  content: ReactNode;
  /** A single focusable element (button, link, icon button). */
  children: ReactElement<Record<string, unknown>>;
  side?: "top" | "bottom";
  className?: string;
}

/** Short supplementary text on hover AND keyboard focus, linked via aria-describedby. CSS-only
 * positioning (no measuring), so keep content to a few words; never put essential information or
 * interactive content in a tooltip. */
export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const id = useId();
  const trigger = isValidElement(children)
    ? cloneElement(children, { "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" ") })
    : children;

  return (
    <span className="group/tooltip relative inline-flex">
      {trigger}
      <span
        id={id}
        role="tooltip"
        className={cn(
          "glass-dark pointer-events-none absolute left-1/2 z-overlay w-max max-w-56 -translate-x-1/2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-cream-50 opacity-0 shadow-float transition-opacity duration-fast ease-smooth",
          "group-hover/tooltip:opacity-100 group-has-[:focus-visible]/tooltip:opacity-100",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}
