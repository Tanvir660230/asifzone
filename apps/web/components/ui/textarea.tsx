import { type TextareaHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-lg border border-ink-200 bg-cream-50 px-3 py-2 text-sm text-ink-900 transition-all duration-200 ease-smooth placeholder:text-ink-400 focus:border-brass-400 focus:shadow-glow disabled:opacity-50",
        "aria-[invalid=true]:border-danger-400 aria-[invalid=true]:focus:border-danger-500 aria-[invalid=true]:focus:shadow-none",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
