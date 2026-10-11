import { type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** Status/label pill. Pick the variant by meaning (success, warning…), never by color. `sale` is
 * reserved for promotional labels. */
export const badgeVariants = cva("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      neutral: "bg-ink-100 text-ink-700",
      success: "bg-success-100 text-success-700",
      warning: "bg-warning-100 text-warning-700",
      danger: "bg-danger-100 text-danger-700",
      info: "bg-info-100 text-info-700",
      accent: "bg-accent text-accent-fg",
      outline: "border border-line text-ink-600",
      sale: "bg-sale-500 text-white",
    },
  },
  defaultVariants: { variant: "neutral" },
});

const DOT: Record<NonNullable<VariantProps<typeof badgeVariants>["variant"]>, string> = {
  neutral: "bg-ink-400",
  success: "bg-success-500",
  warning: "bg-warning-500",
  danger: "bg-danger-500",
  info: "bg-info-500",
  accent: "bg-accent-fg",
  outline: "bg-ink-400",
  sale: "bg-white",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Leading status dot — reads as "state" rather than "label". */
  dot?: boolean;
}

export function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", DOT[variant ?? "neutral"])} aria-hidden="true" />}
      {children}
    </span>
  );
}
