import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium tracking-wide transition-all duration-200 ease-smooth active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100",
  {
    variants: {
      variant: {
        primary: "glossy bg-ink-900 text-cream-50 shadow-sm hover:bg-ink-800 hover:shadow-float",
        secondary: "glossy bg-cream-200 text-ink-900 hover:bg-cream-300",
        outline: "border border-ink-300 text-ink-900 hover:border-ink-400 hover:bg-ink-50",
        ghost: "text-ink-700 hover:bg-ink-50",
        destructive: "glossy bg-danger-600 text-white shadow-sm hover:bg-danger-700 hover:shadow-float",
        brass: "glossy bg-brass-400 text-ink-900 shadow-sm hover:bg-brass-500 hover:shadow-float",
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
