import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A card cut like Tahafi's hang-tag (the `.ui-hang-tag` recipe: both top corners cut, a punched hole at the top) — the
 * product page's delivery dates and promises, the bag's sum, the order's confirmation. */
export function TagCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("ui-hang-tag relative bg-surface px-4 pb-4 pt-9 sm:px-5", className)}>
      <span aria-hidden="true" className="absolute left-1/2 top-3.5 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-canvas shadow-[inset_0_0_0_1px_rgb(var(--color-ink-300))]" />
      {children}
    </div>
  );
}
