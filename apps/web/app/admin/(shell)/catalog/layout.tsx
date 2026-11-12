import type { ReactNode } from "react";
import { SectionFrame } from "@/components/admin/section-frame";

/** Catalog setup: its ten pages as one row of tabs above the page (components/admin/section-frame.tsx). */
export default function CatalogSetupLayout({ children }: { children: ReactNode }) {
  return (
    <SectionFrame>{children}</SectionFrame>
  );
}
