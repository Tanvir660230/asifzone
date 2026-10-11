import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The arch's outline, in the same 100 × 125 box as the `.ui-arch` mask (globals.css). */
export const ARCH_PATH = "M0 125V46C0 22 22 6 50 0c28 6 50 22 50 46v79z";

/**
 * The mihrab preset's one signature shape: a pointed arch — the doorway of the store's own mark — framing a photograph.
 * The frame's aspect ratio is the caller's (4:5 or taller keeps the point crisp). `outline` draws a second, offset arch
 * in warm stone behind the photograph, for the few places that carry the brand (hero, story).
 */
export function Arch({ children, className, outline = false }: { children: ReactNode; className?: string; outline?: boolean }) {
  return (
    <div className={cn("relative", className)}>
      {outline && (
        <svg
          aria-hidden
          viewBox="0 0 100 125"
          preserveAspectRatio="none"
          className="ui-arch-outline pointer-events-none absolute -right-3 -top-3 h-full w-full overflow-visible text-[color:var(--arch-outline,rgb(214_193_162))] sm:-right-5 sm:-top-5"
        >
          <path d={ARCH_PATH} pathLength={1} fill="none" stroke="currentColor" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <div className="ui-arch relative h-full w-full overflow-hidden bg-cream-200">{children}</div>
    </div>
  );
}
