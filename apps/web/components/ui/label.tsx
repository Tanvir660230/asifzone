import { type LabelHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  /** Shows the required marker. The control itself must still carry `required`/validation. */
  required?: boolean;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(({ className, required, children, ...props }, ref) => (
  <label ref={ref} className={cn("ui-label", className)} {...props}>
    {children}
    {required && (
      <span className="ml-0.5 text-danger-500" aria-hidden="true">
        *
      </span>
    )}
  </label>
));
Label.displayName = "Label";
