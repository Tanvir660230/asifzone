import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Store Console phones hide the description, as iOS large titles stand alone. Pass true when it carries live
   * figures the page is read for ("41 pending · 113 need attention"), not an explanation of the page. */
  descriptionOnPhone?: boolean;
  /** Right-aligned primary action(s). */
  action?: ReactNode;
  /** Small label above the title (section name, status). */
  eyebrow?: ReactNode;
  /** `lg` for top-level pages, `md` for sub-pages and the customer account area. */
  size?: "lg" | "md";
  className?: string;
}

/** The single page-title block: title, optional description and actions; stacks on mobile. In the Store Console on
 * phones (globals.css, `[data-page-header]`) it tightens to a large title with one swipeable row of actions. */
export function PageHeader({ title, description, descriptionOnPhone, action, eyebrow, size = "lg", className }: PageHeaderProps) {
  return (
    <div
      data-page-header=""
      className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4", size === "lg" ? "mb-8" : "mb-6", className)}
    >
      <div className="min-w-0">
        {eyebrow && <p data-page-eyebrow="" className="mb-1 text-caption font-semibold uppercase text-fg-subtle">{eyebrow}</p>}
        <h1 className={cn("font-display text-fg", size === "lg" ? "text-display-md" : "text-display-sm sm:text-display-md")}>{title}</h1>
        {description && (
          <p data-page-description={descriptionOnPhone ? "keep" : ""} className="mt-1.5 text-sm text-fg-muted">
            {description}
          </p>
        )}
      </div>
      {action && (
        <div data-page-actions="" className="flex shrink-0 flex-wrap items-center gap-2">
          {action}
        </div>
      )}
    </div>
  );
}
