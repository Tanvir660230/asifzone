"use client";

import { useSearchParams } from "next/navigation";
import { CalendarCheck } from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { MonthEnd } from "@/components/admin/finance/month-end";
import { useCapabilities } from "@/hooks/use-capability";

/** Books › Month-end (blueprint P1.6, tab 21 U4): the close checklist for one month — its steps, Draft or Final, and
 * closing or reopening it. Defaults to the month that just ended; `?month=YYYY-MM` opens another. */
export default function MonthEndPage() {
  const { can, ready } = useCapabilities();
  const params = useSearchParams();
  if (ready && !can("finance.view")) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={CalendarCheck} title="Month-end isn't available to your role" description="Ask an owner for access to the books." />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Month-end" description="Everything a month needs before its figures are Final — then close it." />
      <MonthEnd initialMonth={params.get("month")} canClose={can("finance.period_close")} />
    </div>
  );
}
