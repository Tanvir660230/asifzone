"use client";

import { useSearchParams } from "next/navigation";
import { CalendarCheck } from "lucide-react";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { ListPage } from "@/components/admin/patterns/list-page";
import { MonthEnd } from "@/components/admin/finance/month-end";
import { useCapabilities } from "@/hooks/use-capability";
import { PermissionState } from "@/components/admin/permission-state";

/** Books › Month-end (blueprint P1.6, tab 21 U4): the close checklist for one month — its steps, Draft or Final, and
 * closing or reopening it. Defaults to the month that just ended; `?month=YYYY-MM` opens another. */
export default function MonthEndPage() {
  const { can, ready } = useCapabilities();
  const params = useSearchParams();
  if (ready && !can("finance.view")) {
    return (
      <div>
        <ModuleTabs />
        <PermissionState icon={CalendarCheck} page="Month-end" />
      </div>
    );
  }
  return (
    <ListPage title="Month-end" description="Everything a month needs before its figures are Final — then close it." className="space-y-6">
      <MonthEnd initialMonth={params.get("month")} canClose={can("finance.period_close")} />
    </ListPage>
  );
}
