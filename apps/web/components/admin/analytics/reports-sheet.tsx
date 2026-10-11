"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Boxes, Download, FileSpreadsheet, TrendingUp, Users } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import * as analyticsApi from "@/lib/api/admin-analytics";

const REPORTS = [
  {
    id: "customer-rfm",
    title: "Customers (RFM)",
    description: "Recency, frequency, spend and segment tags for every customer with at least one order.",
    icon: Users,
    href: analyticsApi.downloadCustomerRfmCsvUrl(),
  },
  {
    id: "revenue",
    title: "Realised net sales — 365 days",
    description: "Daily realised net sales and orders realised for the last year.",
    icon: TrendingUp,
    href: analyticsApi.downloadRevenueCsvUrl(365),
  },
  {
    id: "inventory-turnover",
    title: "Inventory turnover",
    description: "Cost of goods sold, inventory value and turnover for every active product.",
    icon: Boxes,
    href: analyticsApi.downloadInventoryTurnoverCsvUrl(),
  },
];

function ReportsSheetInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const open = searchParams.get("reports") === "1";
  const setOpen = (next: boolean) => {
    const q = new URLSearchParams(searchParams.toString());
    if (next) q.set("reports", "1");
    else q.delete("reports");
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <FileSpreadsheet size={14} aria-hidden="true" /> Reports
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Reports" widthClassName="max-w-lg">
        <div className="space-y-4 px-6 py-5">
          <p className="text-[13px] text-fg-muted">The data behind Analytics as CSV. Orders and Products have their own filtered exports on their lists.</p>
          <ul className="divide-y divide-line-subtle rounded-2xl border border-line">
            {REPORTS.map((r) => (
              <li key={r.id} className="flex items-start gap-3 p-4">
                <r.icon size={18} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-fg">{r.title}</p>
                  <p className="mt-0.5 text-[13px] text-fg-muted">{r.description}</p>
                </div>
                <a href={r.href} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`Download ${r.title} as CSV`}>
                  <Download size={14} aria-hidden="true" /> CSV
                </a>
              </li>
            ))}
          </ul>
        </div>
      </Drawer>
    </>
  );
}

/** Analytics › Reports (Blueprint V2 P6): CSV exports in a sheet, reachable from every Analytics tab (?reports=1). */
export function ReportsSheet() {
  return (
    <Suspense fallback={null}>
      <ReportsSheetInner />
    </Suspense>
  );
}
