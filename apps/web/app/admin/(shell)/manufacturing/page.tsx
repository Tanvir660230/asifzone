"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Factory } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { MO_STATUS_BADGE, MO_STATUS_LABEL } from "@/components/admin/manufacturing/status";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as mfg from "@/lib/api/manufacturing";
import type { ProductionOrderStatus } from "@/lib/api/manufacturing";
import { formatPrice } from "@/lib/format";

const pct = (v: number | null) => (v === null ? "—" : `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
const STATUS_ORDER: ProductionOrderStatus[] = ["DRAFT", "APPROVED", "IN_PRODUCTION", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"];

/** Production at a glance (docs/MANUFACTURING.md §9): what is being made and what it holds in work in progress, which orders
 * are late or ready to close, how each producer performs, and what recently closed orders really cost against the plan. */
export default function ProductionOverviewPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("manufacturing.view");
  const q = useQuery({ queryKey: mfg.manufacturingKeys.overview(), queryFn: mfg.manufacturingOverview, enabled: allowed });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={Factory} title="Manufacturing isn't available to your role" />
      </div>
    );
  }
  const d = q.data;
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Production" description="Open production, work in progress, producer performance and what closed orders really cost." action={<Link href="/admin/manufacturing/production-orders"><Button size="sm" variant="outline">All production orders</Button></Link>} />
      {q.isLoading && <Skeleton className="h-64 w-full" />}
      {q.isError && <Alert variant="danger" title="The production overview couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>}
      {d && (
        <>
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Open orders" value={d.openOrders.toLocaleString()} />
            {d.openWip !== null && <Stat label="In work in progress" value={formatPrice(d.openWip)} />}
            <Stat label="Late" value={d.open.filter((o) => o.overdue).length.toLocaleString()} hint="Past the expected date with units outstanding" />
            <Stat label="Ready to close" value={d.open.filter((o) => o.readyToClose).length.toLocaleString()} />
          </dl>

          <div className="flex flex-wrap gap-2" aria-label="Orders by status">
            {STATUS_ORDER.filter((s) => d.byStatus[s]).map((s) => (
              <Badge key={s} variant={MO_STATUS_BADGE[s]}>{MO_STATUS_LABEL[s]} · {d.byStatus[s]}</Badge>
            ))}
          </div>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-ink-900">In production</h2>
            {d.open.length ? (
              <Card className="overflow-hidden p-0">
                <HScrollShadow>
                  <Table>
                    <TableHead>
                      <tr>
                        <TableHeaderCell>Order</TableHeaderCell>
                        <TableHeaderCell>Product · producer</TableHeaderCell>
                        <TableHeaderCell align="right">Accepted / planned</TableHeaderCell>
                        <TableHeaderCell>Expected</TableHeaderCell>
                        {d.canSeeCost && <TableHeaderCell align="right">In WIP</TableHeaderCell>}
                        <TableHeaderCell>Status</TableHeaderCell>
                      </tr>
                    </TableHead>
                    <tbody>
                      {d.open.map((o) => (
                        <TableRow key={o.id} data-testid="overview-open-row">
                          <TableCell className="whitespace-nowrap font-mono text-xs"><Link href={`/admin/manufacturing/production-orders/${o.id}`} className="underline-offset-4 hover:underline">{o.number}</Link></TableCell>
                          <TableCell className="min-w-48">{o.product.name}<span className="block text-xs text-ink-500">{o.producer?.displayName ?? "In-house"}</span></TableCell>
                          <TableCell align="right" className="whitespace-nowrap tabular-nums">{o.accepted.toLocaleString()} / {o.planned.toLocaleString()}</TableCell>
                          <TableCell className={o.overdue ? "whitespace-nowrap tabular-nums text-danger-700" : "whitespace-nowrap tabular-nums"}>{o.expectedDate ?? "—"}{o.overdue ? " · late" : ""}</TableCell>
                          {d.canSeeCost && <TableCell align="right" className="tabular-nums">{o.wip === null ? "—" : formatPrice(o.wip)}</TableCell>}
                          <TableCell className="whitespace-nowrap"><Badge variant={MO_STATUS_BADGE[o.status]}>{MO_STATUS_LABEL[o.status]}</Badge>{o.readyToClose && <span className="ml-2 text-xs text-success-700">ready to close</span>}</TableCell>
                        </TableRow>
                      ))}
                    </tbody>
                  </Table>
                </HScrollShadow>
              </Card>
            ) : (
              <EmptyState icon={Factory} title="Nothing in production" description="Approved production orders show here until they close." />
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-ink-900">Producers</h2>
            {d.producers.length ? (
              <Card className="overflow-hidden p-0">
                <HScrollShadow>
                  <Table>
                    <TableHead>
                      <tr>
                        <TableHeaderCell>Producer</TableHeaderCell>
                        <TableHeaderCell align="right">Orders</TableHeaderCell>
                        <TableHeaderCell align="right">Delivered</TableHeaderCell>
                        <TableHeaderCell align="right">Yield</TableHeaderCell>
                        <TableHeaderCell align="right">Rejected</TableHeaderCell>
                        <TableHeaderCell align="right">On time</TableHeaderCell>
                        {d.canSeeCost && <TableHeaderCell align="right">Final cost / unit</TableHeaderCell>}
                      </tr>
                    </TableHead>
                    <tbody>
                      {d.producers.map((p) => (
                        <TableRow key={p.producer?.id ?? "in-house"}>
                          <TableCell className="min-w-40">{p.producer?.displayName ?? "In-house"}</TableCell>
                          <TableCell align="right" className="tabular-nums">{p.orders}</TableCell>
                          <TableCell align="right" className="tabular-nums">{p.delivered.toLocaleString()}</TableCell>
                          <TableCell align="right" className="tabular-nums">{pct(p.yieldPct)}</TableCell>
                          <TableCell align="right" className="tabular-nums">{pct(p.rejectionPct)}</TableCell>
                          <TableCell align="right" className="tabular-nums">{pct(p.onTimePct)}</TableCell>
                          {d.canSeeCost && <TableCell align="right" className="tabular-nums">{p.finalUnitCost === null ? "—" : formatPrice(p.finalUnitCost)}</TableCell>}
                        </TableRow>
                      ))}
                    </tbody>
                  </Table>
                </HScrollShadow>
              </Card>
            ) : (
              <p className="text-sm text-ink-600">No production yet.</p>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-ink-900">Recently closed — planned against final</h2>
            {d.closed.length ? (
              <Card className="overflow-hidden p-0">
                <HScrollShadow>
                  <Table>
                    <TableHead>
                      <tr>
                        <TableHeaderCell>Order</TableHeaderCell>
                        <TableHeaderCell>Product</TableHeaderCell>
                        <TableHeaderCell align="right">Accepted</TableHeaderCell>
                        <TableHeaderCell align="right">Yield</TableHeaderCell>
                        {d.canSeeCost && <TableHeaderCell align="right">Planned / unit</TableHeaderCell>}
                        {d.canSeeCost && <TableHeaderCell align="right">Final / unit</TableHeaderCell>}
                        {d.canSeeCost && <TableHeaderCell align="right">Abnormal loss</TableHeaderCell>}
                      </tr>
                    </TableHead>
                    <tbody>
                      {d.closed.map((o) => {
                        const over = o.finalPerUnit !== null && o.plannedPerUnit !== null && o.finalPerUnit > o.plannedPerUnit;
                        return (
                          <TableRow key={o.id} data-testid="overview-closed-row">
                            <TableCell className="whitespace-nowrap font-mono text-xs"><Link href={`/admin/manufacturing/production-orders/${o.id}`} className="underline-offset-4 hover:underline">{o.number}</Link></TableCell>
                            <TableCell className="min-w-40">{o.product.name}<span className="block text-xs text-ink-500">{o.producer?.displayName ?? "In-house"}</span></TableCell>
                            <TableCell align="right" className="tabular-nums">{o.accepted.toLocaleString()}</TableCell>
                            <TableCell align="right" className="tabular-nums">{pct(o.yieldPct)}</TableCell>
                            {d.canSeeCost && <TableCell align="right" className="tabular-nums">{o.plannedPerUnit === null ? "—" : formatPrice(o.plannedPerUnit)}</TableCell>}
                            {d.canSeeCost && <TableCell align="right" className={over ? "tabular-nums text-danger-700" : "tabular-nums"}>{o.finalPerUnit === null ? "—" : formatPrice(o.finalPerUnit)}</TableCell>}
                            {d.canSeeCost && <TableCell align="right" className="tabular-nums">{o.abnormalLoss ? formatPrice(o.abnormalLoss) : "—"}</TableCell>}
                          </TableRow>
                        );
                      })}
                    </tbody>
                  </Table>
                </HScrollShadow>
              </Card>
            ) : (
              <p className="text-sm text-ink-600">No order has been closed yet — closing fixes an order&apos;s final cost.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <dt className="text-sm text-ink-600">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-ink-900">{value}</dd>
      {hint && <dd className="text-xs text-ink-500">{hint}</dd>}
    </Card>
  );
}
