"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Factory } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ReasonModal } from "@/components/admin/purchasing/reason-modal";
import { SizeColorGrid } from "@/components/admin/manufacturing/size-color-grid";
import { formatUnitCost } from "@/components/admin/manufacturing/format";
import { COST_GROUP_LABEL, MO_STATUS_BADGE, MO_STATUS_LABEL } from "@/components/admin/manufacturing/status";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as mfg from "@/lib/api/manufacturing";
import { formatPrice } from "@/lib/format";

/** One production order (docs/MANUFACTURING.md §5): the plan by size and colour, the materials it needs against what is in
 * stock, the planned costs, and the actions its state allows. */
export default function ProductionOrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can, ready } = useCapabilities();
  const allowed = can("manufacturing.view");
  const mo = useQuery({ queryKey: mfg.manufacturingKeys.order(id), queryFn: () => mfg.getProductionOrder(id), enabled: allowed });
  const [cancelling, setCancelling] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: mfg.manufacturingKeys.all });
  const act = useMutation({
    mutationFn: ({ action, reason }: { action: "approve" | "reopen" | "cancel"; reason?: string }) => mfg.productionOrderAction(id, action, reason),
    onSuccess: (o) => { refresh(); setCancelling(false); toast.success(`${o.number} is ${MO_STATUS_LABEL[o.status]}`); },
    onError: (err) => toast.error(getErrorMessage(err, "That didn't work")),
  });
  const remove = useMutation({
    mutationFn: () => mfg.deleteProductionOrder(id),
    onSuccess: () => { refresh(); toast.success("Draft deleted"); router.push("/admin/manufacturing/production-orders"); },
    onError: (err) => toast.error(getErrorMessage(err, "The draft couldn't be deleted")),
  });

  if (ready && !allowed) return <EmptyState icon={Factory} title="Manufacturing isn't available to your role" />;
  if (mo.isLoading) return <Skeleton className="h-64 w-full" />;
  if (mo.isError || !mo.data) return <Alert variant="danger" title="This production order couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => mo.refetch()}>Retry</Button>}>{getErrorMessage(mo.error, "")}</Alert>;
  const o = mo.data;
  const product = { id: o.product.id, name: o.product.name, variants: o.lines.map((l) => ({ id: l.variantId, sku: l.sku, size: l.size, color: l.color, stock: 0 })) };
  const quantities = Object.fromEntries(o.lines.map((l) => [l.variantId, l.plannedQty]));
  const shortfalls = o.materials.filter((m) => m.shortfall > 0);

  return (
    <div className="space-y-6">
      <BackLink href="/admin/manufacturing/production-orders" label="Production orders" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-ink-900">{o.number}</h1>
          <p className="text-sm text-ink-600">{o.product.name} · {o.inHouse ? "made in-house" : `by ${o.producer?.displayName}`} · ordered {o.orderDate}{o.expectedDate ? ` · expected ${o.expectedDate}` : ""}</p>
        </div>
        <Badge variant={MO_STATUS_BADGE[o.status]} data-testid="mo-status">{MO_STATUS_LABEL[o.status]}</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        {can("manufacturing.approve") && o.status === "DRAFT" && <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ action: "approve" })} data-testid="mo-approve">Approve plan</Button>}
        {can("manufacturing.approve") && o.status === "APPROVED" && <Button size="sm" variant="outline" onClick={() => act.mutate({ action: "reopen" })}>Back to draft</Button>}
        {can("manufacturing.manage") && (o.status === "DRAFT" || o.status === "APPROVED") && <Button size="sm" variant="outline" onClick={() => setCancelling(true)}>Cancel order</Button>}
        {can("manufacturing.manage") && o.status === "DRAFT" && <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>Delete draft</Button>}
      </div>
      {o.cancelledReason && <p className="text-sm text-ink-600">Cancelled: {o.cancelledReason}</p>}

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Units planned" value={o.plannedUnits.toLocaleString()} />
        <Stat label="Bill of materials" value={o.bom ? `Version ${o.bom.version}` : "By hand"} />
        {o.planned && <Stat label="Planned cost" value={plannedValue(o.planned.totalCost, o.planned.materialsWithoutCost)} hint={o.planned.materialsWithoutCost ? `Excludes ${o.planned.materialsWithoutCost} material(s) with no known cost yet` : undefined} />}
        {o.planned && <Stat label="Planned cost per unit" value={o.planned.costPerUnit === null ? "—" : plannedValue(o.planned.costPerUnit, o.planned.materialsWithoutCost)} />}
      </dl>
      {o.terms && <Card className="p-4 text-sm"><p className="text-ink-600">Agreed rate & terms</p><p className="whitespace-pre-line text-ink-900">{o.terms}</p></Card>}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-ink-900">Sizes and colours</h2>
        <SizeColorGrid product={product} quantities={quantities} readOnly />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-ink-900">Materials</h2>
        {shortfalls.length > 0 && o.status !== "CANCELLED" && <Alert variant="warning" title={`${shortfalls.length} material(s) short`}>Stock on hand doesn&apos;t cover the plan — order the difference before issuing.</Alert>}
        {o.materials.length ? (
          <Card className="overflow-hidden p-0">
            <HScrollShadow>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Material</TableHeaderCell>
                    <TableHeaderCell>From</TableHeaderCell>
                    <TableHeaderCell align="right">Needed</TableHeaderCell>
                    <TableHeaderCell align="right">In stock</TableHeaderCell>
                    <TableHeaderCell align="right">Short</TableHeaderCell>
                    {o.planned && <TableHeaderCell align="right">Planned cost</TableHeaderCell>}
                  </tr>
                </TableHead>
                <tbody>
                  {o.materials.map((m) => (
                    <TableRow key={m.id} data-testid="mo-material">
                      <TableCell className="min-w-56"><span className="font-mono text-xs text-ink-600">{m.sku}</span><span className="block text-sm">{m.name}</span></TableCell>
                      <TableCell className="text-sm">{m.suppliedBy === "PRODUCER" ? "Producer supplies" : m.fromBom ? `BOM${m.qtyPerUnit ? ` · ${Number(m.qtyPerUnit)} ${m.stockUnit}/unit${Number(m.wastagePct) ? ` + ${Number(m.wastagePct)}%` : ""}` : ""}` : "Added"}</TableCell>
                      <TableCell align="right" className="whitespace-nowrap tabular-nums">{m.plannedQty.toLocaleString()} {m.stockUnit}</TableCell>
                      <TableCell align="right" className="whitespace-nowrap tabular-nums">{m.suppliedBy === "PRODUCER" ? "—" : `${m.inStock.toLocaleString()} ${m.stockUnit}`}</TableCell>
                      <TableCell align="right" className={m.shortfall ? "whitespace-nowrap tabular-nums text-danger-700" : "tabular-nums text-ink-500"}>{m.shortfall ? `${m.shortfall.toLocaleString()} ${m.stockUnit}` : "—"}</TableCell>
                      {o.planned && <TableCell align="right" className="whitespace-nowrap tabular-nums">{m.plannedCost === null ? (m.suppliedBy === "PRODUCER" ? "in producer price" : o.status === "DRAFT" ? "at approval" : "no cost known") : <>{formatPrice(m.plannedCost)}<span className="block text-xs text-ink-500">{formatUnitCost(m.plannedUnitCost!, m.stockUnit)}</span></>}</TableCell>}
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </HScrollShadow>
          </Card>
        ) : (
          <p className="text-sm text-ink-600">No materials planned — choose a bill of materials or add materials by hand.</p>
        )}
      </section>

      {o.planned && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-ink-900">Planned costs</h2>
          <Card className="divide-y divide-line p-0 text-sm">
            <div className="flex justify-between gap-3 px-4 py-2.5"><span>Materials (from stock, at average cost)</span><span className="tabular-nums">{plannedValue(o.planned.materialCost, o.planned.materialsWithoutCost)}</span></div>
            {o.plannedCosts.map((c) => (
              <div key={c.id} className="flex justify-between gap-3 px-4 py-2.5">
                <span>{c.category.name} <span className="text-xs text-ink-500">· {COST_GROUP_LABEL[c.category.group]}{c.basis ? ` · ${c.basis}` : ""}</span></span>
                <span className="tabular-nums">{c.amount === null ? "—" : formatPrice(c.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between gap-3 px-4 py-2.5 font-semibold"><span>Total</span><span className="tabular-nums">{plannedValue(o.planned.totalCost, o.planned.materialsWithoutCost)}</span></div>
          </Card>
        </section>
      )}

      {cancelling && <ReasonModal title={`Cancel ${o.number}`} hint="Nothing was issued, so the order can be cancelled." loading={act.isPending} onClose={() => setCancelling(false)} onConfirm={(reason) => act.mutate({ action: "cancel", reason })} />}
    </div>
  );
}

/** A planned figure that is missing some material costs is never shown as a plain (understated) number. */
function plannedValue(value: number, missing: number): string {
  if (!missing) return formatPrice(value);
  return value === 0 ? "Not known yet" : `${formatPrice(value)}+`;
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
