import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn("h-4 w-4 rounded border-ink-300 accent-brass-400 disabled:opacity-50", className)}
      {...props}
    />
  ),
);
Checkbox.displayName = "Checkbox";
