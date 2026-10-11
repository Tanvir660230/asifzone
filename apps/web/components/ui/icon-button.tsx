import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const iconButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full transition-[background-color,color,box-shadow,transform] duration-fast ease-smooth active:scale-95 disabled:pointer-events-none disabled:opacity-30",
  {
    variants: {
      variant: {
        ghost: "text-ink-500 hover:bg-ink-900/[0.06] hover:text-fg",
        subtle: "bg-ink-900/[0.04] text-ink-600 hover:bg-ink-900/[0.08] hover:text-fg",
        outline: "border border-line bg-surface text-ink-600 hover:border-line-strong hover:text-fg",
        glass: "glass border border-white/60 text-fg shadow-glass hover:bg-surface/90",
        danger: "text-danger-600 hover:bg-danger-50",
      },
      size: {
        sm: "h-7 w-7",
        md: "h-9 w-9",
        lg: "h-11 w-11",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof iconButtonVariants> {
  /** Required — an icon-only control has no visible text, so this is its accessible name. */
  "aria-label": string;
}

/** Icon-only button (close, previous/next, row actions). The md/lg sizes meet touch-target size;
 * use sm only in dense desktop rows. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button ref={ref} type={type} className={cn(iconButtonVariants({ variant, size }), className)} {...props} />
  ),
);
IconButton.displayName = "IconButton";
