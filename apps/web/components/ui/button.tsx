import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded text-sm font-medium tracking-wide transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-ink-900 text-cream-50 hover:bg-ink-800",
        secondary: "bg-cream-200 text-ink-900 hover:bg-cream-300",
        outline: "border border-ink-300 text-ink-900 hover:bg-ink-50",
        ghost: "text-ink-700 hover:bg-ink-50",
        destructive: "bg-danger-600 text-white hover:bg-danger-700",
        brass: "bg-brass-400 text-ink-900 hover:bg-brass-500",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";
