import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Breadcrumb } from "./breadcrumb";

/** The frame of a storefront or account page (`.ui-page`): one width, one set of gutters, one distance below the header,
 * so every page starts in the same place. */
export function StorefrontPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("ui-page", className)}>{children}</div>;
}

interface StorefrontPageHeaderProps {
  title: ReactNode;
  /** A short label above the title ("Help", "Your account"). */
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Shown instead of the eyebrow: where this page sits ("Home › Men › Prayer caps"). */
  breadcrumb?: { name: string; href?: string }[];
  /** Controls on the right of the title (sort, an action button). */
  actions?: ReactNode;
  /** For the actions' slot, e.g. `max-lg:hidden` when they only exist from 1024px (no empty gap under the title). */
  actionsClassName?: string;
  className?: string;
}

/** The one page heading: breadcrumb or eyebrow, the title in the page-title size, a line of context, optional actions.
 * Every page uses it, so titles share one size, one font and one position across the site. */
export function StorefrontPageHeader({ title, eyebrow, description, breadcrumb, actions, actionsClassName, className }: StorefrontPageHeaderProps) {
  return (
    <header className={cn("mb-6 sm:mb-8 lg:mb-10", className)}>
      {/* The row above the title (breadcrumb or eyebrow) is one fixed height, so titles line up from page to page. Phones
          have no breadcrumb (the header's Back is the way up), so its row and gap go with it. */}
      {breadcrumb ? <Breadcrumb trail={breadcrumb} /> : eyebrow ? <div className="flex h-4 items-center text-xs ui-eyebrow text-fg-muted">{eyebrow}</div> : null}
      <div
        className={cn(
          "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
          breadcrumb ? "lg:mt-4" : eyebrow && "mt-4",
        )}
      >
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-balance font-display ui-page-title text-ink-900">{title}</h1>
          {description && <p className="mt-2 text-base leading-relaxed text-ink-500">{description}</p>}
        </div>
        {actions && <div className={cn("shrink-0", actionsClassName)}>{actions}</div>}
      </div>
    </header>
  );
}
