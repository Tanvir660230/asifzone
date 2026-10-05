import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Shimmering placeholder (`.ui-skeleton`). Size and shape it with utilities: `h-4 w-1/2`,
 * `aspect-square rounded-xl`, `h-10 w-10 rounded-full`. Purely decorative — the loading region
 * should carry `aria-busy` (or the page a status message) for assistive tech. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("ui-skeleton", className)} {...props} />;
}

/** A few lines of text-shaped skeleton. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="ui-skeleton h-3.5" style={{ width: i === lines - 1 ? "60%" : "100%" }} />
      ))}
    </div>
  );
}
