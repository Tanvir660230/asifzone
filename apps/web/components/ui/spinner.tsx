import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SpinnerProps {
  size?: number;
  className?: string;
  /** Announced to screen readers; omit when the surrounding control already says it's busy. */
  label?: string;
}

/** The one loading indicator. Inherits text color, so it works on any surface. */
export function Spinner({ size = 16, className, label }: SpinnerProps) {
  return (
    <>
      <Loader2 size={size} className={cn("shrink-0 animate-spin", className)} aria-hidden="true" />
      {label && <span className="sr-only">{label}</span>}
    </>
  );
}
