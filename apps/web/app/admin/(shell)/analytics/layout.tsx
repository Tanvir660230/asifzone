"use client";

import type { ReactNode } from "react";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { DateRangePicker } from "@/components/admin/date-range-picker";
import { BiDateRangeProvider, useBiDateRange } from "@/components/admin/bi-date-range-context";

/** The one report period for every Analytics tab — a sticky strip under the toolbar, so it reads as the section's
 * setting rather than part of whichever view is showing, and stays in reach while a long report scrolls. */
function ReportPeriodBar() {
  const { range, setRange } = useBiDateRange();
  return (
    <div className="sticky top-header z-raised -mx-4 -mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-canvas px-4 py-2.5 sm:-mx-page sm:-mt-8 sm:px-page">
      <p className="text-[13px] text-fg-muted">
        <span className="font-medium text-fg">Report period</span> · applies to every Analytics tab
      </p>
      <DateRangePicker value={range} onChange={setRange} />
    </div>
  );
}

/** Analytics (Blueprint V2 DR-26): six tabs — Overview, Sales, Products, Customers, Marketing, Operations. */
export default function AnalyticsLayout({ children }: { children: ReactNode }) {
  return (
    <BiDateRangeProvider>
      <div className="space-y-6">
        <ReportPeriodBar />
        <ModuleTabs className="" aria-label="Analytics tabs" />
        {children}
      </div>
    </BiDateRangeProvider>
  );
}
