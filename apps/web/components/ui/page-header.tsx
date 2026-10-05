import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Right-aligned primary action(s). */
  action?: ReactNode;
  /** Small label above the title (section name, status). */
  eyebrow?: ReactNode;
  /** `lg` for top-level pages, `md` for sub-pages and the customer account area. */
  size?: "lg" | "md";
  className?: string;
}

/** The single page-title block: title, optional description and actions; stacks on mobile. */
export function PageHeader({ title, description, action, eyebrow, size = "lg", className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4", size === "lg" ? "mb-8" : "mb-6", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-caption font-semibold uppercase text-fg-subtle">{eyebrow}</p>}
        <h1 className={cn("font-display text-fg", size === "lg" ? "text-display-md" : "text-display-sm sm:text-display-md")}>{title}</h1>
        {description && <p className="mt-1.5 text-sm text-fg-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}
