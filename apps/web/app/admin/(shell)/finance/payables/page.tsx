"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as purchasingApi from "@/lib/api/purchasing";
import { formatPrice } from "@/lib/format";

const BUCKETS = [
  { key: "current", label: "Not yet due" },
  { key: "d1_30", label: "1–30 days" },
  { key: "d31_60", label: "31–60" },
  { key: "d61_90", label: "61–90" },
  { key: "d90_plus", label: "90+" },
] as const;

/** Accounts payable by supplier (docs/FINANCE_PHASE_4E.md): what you owe, by how far past its due date, less credit notes
 * not yet set against a bill. Payments arrive with Phase 4F. */
export default function PayablesPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("ap.view");
  const q = useQuery({ queryKey: purchasingApi.payablesKeys.ageing(), queryFn: purchasingApi.payablesAgeing, enabled: allowed });
  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={Wallet} title="Payables aren't available to your role" />
      </div>
    );
  }
  const d = q.data;
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Supplier dues" description="What you owe each supplier, by how far past due — open bills, less credits and advances. Open a supplier to pay." action={<Link href="/admin/finance/supplier-invoices"><Button size="sm" variant="outline">Supplier bills</Button></Link>} />
      {q.isLoading && <Skeleton className="h-48 w-full" />}
      {q.isError && <Alert variant="danger" title="Payables couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>}
      {d && (
        <>
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Owed to suppliers" value={formatPrice(d.totals.balance)} />
            <Stat label="Overdue" value={formatPrice(d.totals.overdue)} tone={d.totals.overdue > 0 ? "warning" : undefined} />
            <Stat label="Not yet due" value={formatPrice(d.totals.current)} />
            <Stat label="Credits and advances" value={formatPrice(d.totals.credits + d.totals.advances)} />
          </dl>
          {d.suppliers.length ? (
            <Card className="overflow-hidden p-0">
              <HScrollShadow>
                <Table>
                  <TableHead>
                    <tr>
                      <TableHeaderCell>Supplier</TableHeaderCell>
                      {BUCKETS.map((b) => <TableHeaderCell key={b.key} align="right">{b.label}</TableHeaderCell>)}
                      <TableHeaderCell align="right">Credits</TableHeaderCell>
                      <TableHeaderCell align="right">Advances</TableHeaderCell>
                      <TableHeaderCell align="right">Balance</TableHeaderCell>
                    </tr>
                  </TableHead>
                  <tbody>
                    {d.suppliers.map((s) => (
                      <TableRow key={s.supplier.id} data-testid="ageing-row">
                        <TableCell className="min-w-44"><Link href={`/admin/finance/payables/${s.supplier.id}`} className="underline-offset-4 hover:underline">{s.supplier.displayName}</Link><span className="block text-xs text-ink-500">{s.supplier.code} · {s.invoices} bill{s.invoices === 1 ? "" : "s"}</span></TableCell>
                        {BUCKETS.map((b) => <TableCell key={b.key} align="right" className={b.key !== "current" && s[b.key] > 0 ? "tabular-nums text-danger-700" : "tabular-nums"}>{s[b.key] ? formatPrice(s[b.key]) : "—"}</TableCell>)}
                        <TableCell align="right" className="tabular-nums">{s.credits ? `−${formatPrice(s.credits)}` : "—"}</TableCell>
                        <TableCell align="right" className="tabular-nums">{s.advances ? `−${formatPrice(s.advances)}` : "—"}</TableCell>
                        <TableCell align="right" className="font-semibold tabular-nums">{formatPrice(s.balance)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="font-semibold">Total</TableCell>
                      {BUCKETS.map((b) => <TableCell key={b.key} align="right" className="font-semibold tabular-nums">{formatPrice(d.totals[b.key])}</TableCell>)}
                      <TableCell align="right" className="font-semibold tabular-nums">{d.totals.credits ? `−${formatPrice(d.totals.credits)}` : "—"}</TableCell>
                      <TableCell align="right" className="font-semibold tabular-nums">{d.totals.advances ? `−${formatPrice(d.totals.advances)}` : "—"}</TableCell>
                      <TableCell align="right" className="font-semibold tabular-nums">{formatPrice(d.totals.balance)}</TableCell>
                    </TableRow>
                  </tbody>
                </Table>
              </HScrollShadow>
            </Card>
          ) : (
            <EmptyState icon={Wallet} title="Nothing owed" description="Posted supplier bills show here until they are paid." />
          )}
          <p className="text-xs text-ink-500">As of {d.asOf}. Days past due count from each bill&apos;s due date.</p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <Card className="p-4">
      <dt className="text-sm text-ink-600">{label}</dt>
      <dd className={tone === "warning" ? "text-lg font-semibold tabular-nums text-warning-700" : "text-lg font-semibold tabular-nums text-ink-900"}>{value}</dd>
    </Card>
  );
}
