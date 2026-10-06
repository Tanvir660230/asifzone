"use client";

import type { ReactNode } from "react";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { DateRangePicker } from "@/components/admin/date-range-picker";
import { BiDateRangeProvider, useBiDateRange } from "@/components/admin/bi-date-range-context";

function BiDateRangeBar() {
  const { range, setRange } = useBiDateRange();
  return (
    <div className="flex justify-end">
      <DateRangePicker value={range} onChange={setRange} />
    </div>
  );
}

export default function BiLayout({ children }: { children: ReactNode }) {
  return (
    <BiDateRangeProvider>
      <div className="space-y-6">
        <ModuleTabs className="" aria-label="Business intelligence sections" />
        <BiDateRangeBar />
        {children}
      </div>
    </BiDateRangeProvider>
  );
}
