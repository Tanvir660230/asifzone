import { type InputHTMLAttributes, type ReactNode, forwardRef } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Fixed text or icon inside the start of the field (currency code, "/product/", a search icon). */
  leading?: ReactNode;
  /** Fixed text or icon inside the end of the field (unit, "%"). */
  trailing?: ReactNode;
}

/** Text-like input. Styling is the shared `.ui-control` recipe (globals.css) — the same one Select, Textarea,
 * SearchableSelect and IconPicker use. Set `aria-invalid` for the error state. */
export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, leading, trailing, ...props }, ref) => {
  if (!leading && !trailing) return <input ref={ref} className={cn("ui-control", className)} {...props} />;
  return (
    <div className="relative">
      {leading && (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-fg-subtle" aria-hidden="true">
          {leading}
        </span>
      )}
      <input ref={ref} className={cn("ui-control", leading && "pl-12", trailing && "pr-10", className)} {...props} />
      {trailing && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-fg-subtle" aria-hidden="true">
          {trailing}
        </span>
      )}
    </div>
  );
});
Input.displayName = "Input";
