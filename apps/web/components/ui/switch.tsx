import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

// forwardRef so this can sit in an RHF <Controller field.ref> slot like every other form
// primitive in the kit — without it, RHF has no way to focus this field on a validation error.
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onChange, disabled, "aria-label": ariaLabel }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full ring-1 ring-inset transition-colors duration-base ease-smooth disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-accent ring-accent" : "bg-ink-300 ring-ink-400",
      )}
    >
      <span
        className={cn(
          "inline-block transform rounded-full bg-white shadow-sm transition-transform duration-base ease-smooth",
          checked ? "translate-x-6" : "translate-x-1",
        )}
        style={{ height: "1.125rem", width: "1.125rem" }}
      />
    </button>
  ),
);
Switch.displayName = "Switch";
