import type { ReactNode } from "react";
import { InnerNav } from "@/components/admin/inner-nav";

/** Catalog setup (Blueprint V2 N4): its ten pages as an inner list beside the page on wide screens; tabs on phones. */
export default function CatalogSetupLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
      <InnerNav title="Catalog setup" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
