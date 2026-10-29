"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Old Needs attention links (blueprint P1.1 / P1.6, tab 2 §2): every finance alert is on Home's work queue now (P1.2), so
 * this page only forwards — `?view=month-end` to Books › Month-end with its month, anything else to Home's queue. */
export default function FinanceAttentionPage() {
  const params = useSearchParams();
  const router = useRouter();
  const monthEnd = params.get("view") === "month-end";
  const month = params.get("month");
  useEffect(() => {
    router.replace(monthEnd ? `/admin/finance/month-end${month ? `?month=${encodeURIComponent(month)}` : ""}` : "/admin/dashboard?queue=finance#work-queue");
  }, [monthEnd, month, router]);
  return null;
}
