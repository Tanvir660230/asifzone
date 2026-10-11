import { type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** Content cards stay solid for readability; `glass` is for cards that sit over imagery or
 * gradients. `interactive` adds the hover lift for clickable cards. */
export const cardVariants = cva("rounded-xl transition-[box-shadow,border-color,transform] duration-base ease-smooth", {
  variants: {
    variant: {
      default: "border border-line-subtle bg-surface shadow",
      glass: "glass-panel",
      muted: "border border-line-subtle bg-surface-muted",
      outline: "border border-line bg-transparent",
    },
    interactive: {
      true: "cursor-pointer hover:-translate-y-px hover:border-line hover:shadow-float",
      false: "",
    },
  },
  defaultVariants: { variant: "default", interactive: false },
});

export interface CardProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

export function Card({ className, variant, interactive, ...props }: CardProps) {
  return <div className={cn(cardVariants({ variant, interactive }), className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-line-subtle px-6 py-5 sm:px-8", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("font-display text-lg tracking-tight text-fg", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1 text-sm text-fg-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 py-6 sm:px-8", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center justify-end gap-2 border-t border-line-subtle px-6 py-4 sm:px-8", className)} {...props} />;
}
