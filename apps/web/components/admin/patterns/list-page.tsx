import type { ReactNode } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";

interface ListPageProps {
  title: string;
  /** One line under the title. Hidden on phones unless `descriptionOnPhone` (PageHeader). */
  description?: ReactNode;
  descriptionOnPhone?: boolean;
  /** The page's one primary action, top right ("Add coupon"). */
  action?: ReactNode;
  /** A short explanation of what the list is for, under the tabs. Hidden on phones (globals.css `[data-page-intro]`). */
  intro?: ReactNode;
  /** The filter row: search on the left, chips / views / date range after it. A switch between lists (Coupons / Trash,
   * Pending / Approved) goes here too, as a SegmentedControl. */
  filters?: ReactNode;
  /** Right end of the filter row (rows per page, a count, export). */
  filtersEnd?: ReactNode;
  /** Draw the group's tab row (`ModuleTabs`). Default true; it renders nothing where the shell already shows the tabs. */
  tabs?: boolean;
  /** The body: a DataTable (or the Table primitives), plus the page's dialogs. */
  children: ReactNode;
  /** Small print under the list ("Only the store owner can change catalog setup."). */
  footnote?: ReactNode;
  className?: string;
}

/**
 * The list page anatomy of DESIGN_SYSTEM §6, fixed in one place: header (title, description, primary action) → the
 * group's tabs → intro line → filter row → the list → footnote. Pages fill the slots and never re-space them, so every
 * list has its title, action, filters and table in the same place.
 */
export function ListPage({ title, description, descriptionOnPhone, action, intro, filters, filtersEnd, tabs = true, children, footnote, className }: ListPageProps) {
  return (
    <div data-pattern="list-page" className={className}>
      <PageHeader title={title} description={description} descriptionOnPhone={descriptionOnPhone} action={action} />
      {tabs && <ModuleTabs />}
      {intro && (
        <p data-page-intro="" className="mb-4 max-w-3xl text-sm text-fg-muted">
          {intro}
        </p>
      )}
      {(filters || filtersEnd) && (
        <div data-list-filters="" className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{filters}</div>
          {filtersEnd && <div className="flex shrink-0 items-center gap-2">{filtersEnd}</div>}
        </div>
      )}
      {children}
      {footnote && <p className="mt-3 text-xs text-fg-subtle">{footnote}</p>}
    </div>
  );
}
