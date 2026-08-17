import { type SelectHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-10 w-full rounded-lg border border-ink-200 bg-cream-50 px-3 text-sm text-ink-900 transition-all duration-200 ease-smooth focus:border-brass-400 focus:shadow-glow disabled:opacity-50",
        "aria-[invalid=true]:border-danger-400 aria-[invalid=true]:focus:border-danger-500 aria-[invalid=true]:focus:shadow-none",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";
