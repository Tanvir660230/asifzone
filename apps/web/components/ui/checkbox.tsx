import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn(
      // 24px on touch screens (WCAG 2.5.8): row checkboxes in dense admin lists are tapped on phones.
      "h-4 w-4 shrink-0 cursor-pointer [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-6 rounded border-line-strong accent-accent transition-transform duration-fast ease-smooth active:scale-90 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Checkbox.displayName = "Checkbox";
