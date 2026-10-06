import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

/** The single button recipe. Also applied to links via `buttonVariants(...)` (e.g. storefront
 * pagination), so a link-styled-as-button never drifts from a real button. */
export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--control-radius)] text-sm font-medium tracking-wide transition-[background-color,border-color,color,box-shadow,transform] duration-base ease-smooth active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 aria-busy:cursor-progress",
  {
    variants: {
      variant: {
        primary: "glossy bg-accent text-accent-fg shadow-sm hover:bg-[color:var(--accent-hover)] hover:shadow-float",
        secondary: "glossy bg-cream-200 text-fg hover:bg-cream-300",
        outline: "border border-line-strong bg-surface/60 text-fg hover:border-ink-400 hover:bg-surface",
        ghost: "text-ink-700 hover:bg-ink-900/[0.05] hover:text-fg",
        // Translucent capsule for controls that sit on imagery or glass chrome.
        glass: "glass border border-white/60 text-fg shadow-glass hover:bg-surface/90",
        destructive: "glossy bg-danger-600 text-white shadow-sm hover:bg-danger-700 hover:shadow-float",
        // Promotional CTAs only (apply a coupon, claim a deal) — the brand's single red accent.
        sale: "glossy bg-sale-500 text-white shadow-sm hover:bg-sale-600 hover:shadow-float",
        // Inline text action.
        link: "h-auto rounded-md px-0 text-fg underline-offset-4 hover:underline active:scale-100",
        // Legacy name kept for existing call sites; identical to `primary` (the brand has no gold accent).
        brass: "glossy bg-accent text-accent-fg shadow-sm hover:bg-[color:var(--accent-hover)] hover:shadow-float",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
        "icon-sm": "h-8 w-8 p-0",
        icon: "h-10 w-10 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Shows a spinner, marks the button busy and disables it — for in-flight submits. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading = false, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner size={size === "lg" ? 18 : 15} />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
