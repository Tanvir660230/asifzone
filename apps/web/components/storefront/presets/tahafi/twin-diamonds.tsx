import { cn } from "@/lib/utils";

/** The two diamonds that crown Tahafi's mark, touching at one point (the logo's proportions), in the current colour. */
export function TwinDiamonds({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 156 78" className={cn("fill-current", className)}>
      <path d="M39 0l39 39-39 39L0 39z" />
      <path d="M117 0l39 39-39 39-39-39z" />
    </svg>
  );
}
