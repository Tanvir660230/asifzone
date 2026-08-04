import { type LabelHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn("mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-500", className)} {...props} />
  ),
);
Label.displayName = "Label";
