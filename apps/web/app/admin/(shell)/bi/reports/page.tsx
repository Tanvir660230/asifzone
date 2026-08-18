"use client";

import { Download, Info, Users, TrendingUp, Boxes } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import * as analyticsApi from "@/lib/api/admin-analytics";

const REPORTS = [
  {
    id: "customer-rfm",
    title: "Customer RFM export",
    description: "Recency, frequency, monetary value, and segment tags for every customer with at least one order.",
    icon: Users,
    href: analyticsApi.downloadCustomerRfmCsvUrl(),
  },
  {
    id: "revenue",
    title: "Revenue export (365 days)",
    description: "Daily order count and revenue for the last 365 days.",
    icon: TrendingUp,
    href: analyticsApi.downloadRevenueCsvUrl(365),
  },
  {
    id: "inventory-turnover",
    title: "Inventory turnover export",
    description: "COGS sold, inventory value, and turnover ratio for every active product.",
    icon: Boxes,
    href: analyticsApi.downloadInventoryTurnoverCsvUrl(),
  },
];

export default function ReportsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl tracking-tight text-ink-900 sm:text-3xl">Reports</h1>
        <p className="mt-1 text-sm text-ink-500">Download the underlying data behind the BI dashboards as CSV.</p>
      </div>

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((report) => (
          <Card key={report.id} className="flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <report.icon size={18} className="text-ink-500" />
                {report.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-4">
              <p className="text-sm text-ink-500">{report.description}</p>
              <a href={report.href} className="self-start">
                <Button variant="outline">
                  <Download size={16} /> Download CSV
                </Button>
              </a>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="flex items-start gap-3 border-info-100 bg-info-50/60 p-4">
        <Info size={18} className="mt-0.5 shrink-0 text-info-600" />
        <p className="text-sm text-info-700">
          Orders and Products already have their own filtered CSV export under their respective admin list pages. PDF export isn&apos;t
          available for these reports — the only PDF-style output in the app is the browser-print invoice/shipping-label pages under
          Orders, which aren&apos;t general-purpose report generators.
        </p>
      </Card>
    </div>
  );
}
