"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BellRing, CalendarCheck, CheckCircle2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { AlertSeverity } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

const SEVERITY: Record<AlertSeverity, { label: string; variant: "danger" | "warning" | "info" }> = {
  critical: { label: "Critical", variant: "danger" },
  warning: { label: "Warning", variant: "warning" },
  info: { label: "For your information", variant: "info" },
};

/** What needs the owner's attention in the books (docs/FINANCE_ALERTS.md). Every alert is computed from the books, links
 * to where it is fixed and clears by itself once it is. The month-end close is its own page (Books › Month-end): an old
 * link to `?view=month-end` lands there with its month. */
export default function FinanceAttentionPage() {
  const { can, ready } = useCapabilities();
  const params = useSearchParams();
  const router = useRouter();
  const monthEnd = params.get("view") === "month-end";
  const month = params.get("month");
  useEffect(() => {
    if (monthEnd) router.replace(`/admin/finance/month-end${month ? `?month=${encodeURIComponent(month)}` : ""}`);
  }, [monthEnd, month, router]);
  if (monthEnd) return null;
  if (ready && !can("finance.view")) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={BellRing} title="Finance alerts aren't available to your role" />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Needs attention"
        description="What is waiting in the books. The same alerts are on Home."
        action={<Link href="/admin/finance/month-end" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}><CalendarCheck className="h-4 w-4" aria-hidden /> Month-end close</Link>}
      />
      <Alerts />
    </div>
  );
}

function Alerts() {
  const q = useQuery({ queryKey: financeApi.alertKeys.all, queryFn: financeApi.getFinanceAlerts });
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <Alert variant="danger" title="Alerts couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>;
  const { alerts, counts, asOf } = q.data;
  if (!alerts.length) {
    return <EmptyState variant="bordered" icon={CheckCircle2} title="Nothing needs attention" description={`Every event is posted, nothing is overdue and every check matches (as of ${asOf}).`} testId="alerts-empty" />;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-600" data-testid="alert-counts">
        {[counts.critical && `${counts.critical} critical`, counts.warning && `${counts.warning} to deal with`, counts.info && `${counts.info} for your information`].filter(Boolean).join(" · ")} — as of {asOf}
      </p>
      <Card className="divide-y divide-line p-0">
        {alerts.map((a) => (
          <div key={a.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4" data-testid={`alert-${a.key}`}>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={SEVERITY[a.severity].variant} dot>{SEVERITY[a.severity].label}</Badge>
                <span className="font-medium text-ink-900">{a.title}</span>
                <span className="tabular-nums text-ink-600">({a.count})</span>
              </div>
              {a.detail && <p className="break-words text-sm text-ink-600">{a.detail}</p>}
            </div>
            {a.amount !== null && <span className="shrink-0 text-sm font-medium tabular-nums text-ink-900 sm:text-right">{formatPrice(a.amount)}</span>}
            <Link href={a.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0 self-start sm:self-auto")}>{a.action}</Link>
          </div>
        ))}
      </Card>
    </div>
  );
}

