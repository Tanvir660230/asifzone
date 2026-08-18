"use client";

import type { ReactNode } from "react";
import { BiSubNav } from "@/components/admin/bi-subnav";
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
        <BiSubNav />
        <BiDateRangeBar />
        {children}
      </div>
    </BiDateRangeProvider>
  );
}
