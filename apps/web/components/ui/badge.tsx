import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-medium text-ink-700",
        className,
      )}
      {...props}
    />
  );
}
