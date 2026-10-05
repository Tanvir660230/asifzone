import { type SelectHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

/** Native select (keeps the platform picker on mobile) with the shared control look and one chevron. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn("ui-control ui-select", className)} {...props}>
      {children}
    </select>
  ),
);
Select.displayName = "Select";
