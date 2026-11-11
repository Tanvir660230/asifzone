import type { ReactNode } from "react";
import { ModuleTabs } from "@/components/admin/module-tabs";

/**
 * The frame of a group of pages (Catalog setup, Stock's purchasing and production pages, the money groups). One rule
 * for the whole console: the sidebar lists modules, the bar under the toolbar lists the module's pages, and a group's
 * own pages are one row of tabs above the page. No second menu column beside the page, so the page keeps the full width.
 */
export function SectionFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <ModuleTabs frame />
      {children}
    </>
  );
}
