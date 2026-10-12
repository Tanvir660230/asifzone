"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, PackageCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ReasonModal } from "@/components/admin/purchasing/reason-modal";
import { GRN_STATUS_BADGE, GRN_STATUS_LABEL, PO_STATUS_BADGE, PO_STATUS_LABEL } from "@/components/admin/purchasing/status";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as purchasingApi from "@/lib/api/purchasing";
import type { PurchaseOrder } from "@/lib/api/purchasing";
import { formatPrice } from "@/lib/format";

/** One purchase order (docs/FINANCE_PHASE_4D.md): its lines, what has arrived, and the actions its state allows. */
export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can, ready } = useCapabilities();
  const allowed = can("purchasing.view");
  const po = useQuery({ queryKey: purchasingApi.purchasingDocKeys.order(id), queryFn: () => purchasingApi.getPurchaseOrder(id), enabled: allowed });
  const overview = useQuery({ queryKey: purchasingApi.purchasingKeys.status(), queryFn: purchasingApi.purchasingOverview, enabled: allowed });
  const [reasonFor, setReasonFor] = useState<"cancel" | "close" | null>(null);
  const [receiving, setReceiving] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: purchasingApi.purchasingKeys.all });

  const act = useMutation({
    mutationFn: ({ action, reason }: { action: "submit" | "return-to-draft" | "approve" | "cancel" | "close"; reason?: string }) => purchasingApi.purchaseOrderAction(id, action, reason),
    onSuccess: (o) => { refresh(); setReasonFor(null); toast.success(`${o.number} is ${PO_STATUS_LABEL[o.status]}`); },
    onError: (err) => toast.error(getErrorMessage(err, "That didn't work")),
  });
  const remove = useMutation({
    mutationFn: () => purchasingApi.deletePurchaseOrder(id),
    onSuccess: () => { refresh(); toast.success("Draft deleted"); router.push("/admin/finance/purchase-orders"); },
    onError: (err) => toast.error(getErrorMessage(err, "The draft couldn't be deleted")),
  });

  if (ready && !allowed) return <EmptyState icon={ClipboardList} title="Purchasing isn't available to your role" />;
  if (po.isLoading) return <Skeleton className="h-64 w-full" />;
  if (po.isError || !po.data) return <Alert variant="danger" title="This purchase order couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => po.refetch()}>Retry</Button>}>{getErrorMessage(po.error, "")}</Alert>;
  const o = po.data;
  const receivable = ["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(o.status) && o.lines.some((l) => l.lineType === "STOCK");

  return (
    <div className="space-y-6">
      <BackLink href="/admin/finance/purchase-orders" label="Purchase orders" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-ink-900">{o.number}</h1>
          <p className="text-sm text-ink-600">{o.supplier.displayName} · ordered {o.orderDate}{o.expectedDate ? ` · expected ${o.expectedDate}` : ""}</p>
        </div>
        <Badge variant={PO_STATUS_BADGE[o.status]} data-testid="po-status">{PO_STATUS_LABEL[o.status]}</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        {can("purchasing.manage") && o.status === "DRAFT" && <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ action: "submit" })} data-testid="po-submit">Submit for approval</Button>}
        {can("purchasing.approve") && o.status === "SUBMITTED" && <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ action: "approve" })} data-testid="po-approve">Approve</Button>}
        {can("purchasing.manage") && o.status === "SUBMITTED" && <Button size="sm" variant="outline" onClick={() => act.mutate({ action: "return-to-draft" })}>Back to draft</Button>}
        {can("purchasing.receive") && receivable && <Button size="sm" onClick={() => setReceiving(true)} data-testid="po-receive"><PackageCheck className="h-4 w-4" /> Receive goods</Button>}
        {can("purchasing.approve") && ["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(o.status) && <Button size="sm" variant="outline" onClick={() => setReasonFor("close")}>Close order</Button>}
        {can("purchasing.manage") && ["DRAFT", "SUBMITTED", "APPROVED"].includes(o.status) && !o.lines.some((l) => l.qtyReceived > 0) && <Button size="sm" variant="outline" onClick={() => setReasonFor("cancel")}>Cancel order</Button>}
        {can("purchasing.manage") && o.status === "DRAFT" && <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>Delete draft</Button>}
      </div>
      {receivable && overview.data && !overview.data.costingActive && (
        <Alert variant="info" title="Receipts post after the valuation cutover">You can prepare a receipt now; posting it waits until inventory costing is switched on (Finance → Setup & checks → Opening stock value).</Alert>
      )}
      {o.closedReason && <p className="text-sm text-ink-600">{o.status === "CANCELLED" ? "Cancelled" : "Closed"}: {o.closedReason}</p>}

      <Card className="overflow-hidden p-0">
        <HScrollShadow>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>#</TableHeaderCell>
                <TableHeaderCell>Item</TableHeaderCell>
                <TableHeaderCell align="right">Ordered</TableHeaderCell>
                <TableHeaderCell align="right">Received</TableHeaderCell>
                <TableHeaderCell align="right">Open</TableHeaderCell>
                <TableHeaderCell align="right">Unit price</TableHeaderCell>
                <TableHeaderCell>Tax</TableHeaderCell>
                <TableHeaderCell align="right">Total</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {o.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="tabular-nums">{l.lineNo}</TableCell>
                  <TableCell className="min-w-56">
                    {l.sku && <span className="font-mono text-xs text-ink-600">{l.sku}</span>}
                    <span className="block text-sm">{l.description}</span>
                    {l.expenseAccount && <span className="text-xs text-ink-500">{l.expenseAccount.code} {l.expenseAccount.name}</span>}
                  </TableCell>
                  <TableCell align="right" className="tabular-nums">{l.qtyOrdered}</TableCell>
                  <TableCell align="right" className="tabular-nums">{l.lineType === "STOCK" ? l.qtyReceived : "—"}{l.qtyReturned ? <span className="block text-xs text-ink-500">{l.qtyReturned} returned</span> : null}</TableCell>
                  <TableCell align="right" className="tabular-nums">{l.lineType === "STOCK" ? l.qtyOpen : "—"}</TableCell>
                  <TableCell align="right" className="tabular-nums">{formatPrice(l.unitPrice)}</TableCell>
                  <TableCell className="text-sm">{l.taxCode ? `${l.taxCode.code} (${l.taxCode.rate}%)` : "—"}</TableCell>
                  <TableCell align="right" className="tabular-nums">{formatPrice(l.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </HScrollShadow>
        <p className="border-t border-line px-4 py-3 text-right text-sm tabular-nums text-ink-900">Total before tax <strong>{formatPrice(o.total)}</strong></p>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink-900">Goods receipts</h2>
        {o.receipts?.length ? (
          <Card className="divide-y divide-line p-0">
            {o.receipts.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <Link href={`/admin/finance/goods-receipts?purchaseOrderId=${o.id}`} className="font-mono text-xs underline-offset-4 hover:underline">{r.number}</Link>
                <span className="tabular-nums text-ink-600">{r.receiptDate}</span>
                <Badge variant={GRN_STATUS_BADGE[r.status]}>{GRN_STATUS_LABEL[r.status]}</Badge>
              </div>
            ))}
          </Card>
        ) : (
          <p className="text-sm text-ink-600">Nothing received yet.</p>
        )}
      </section>

      {reasonFor && <ReasonModal title={reasonFor === "cancel" ? "Cancel this order" : "Close this order"} hint={reasonFor === "close" ? "No more goods will be received on it." : "Nothing was received, so it can be cancelled."} loading={act.isPending} onClose={() => setReasonFor(null)} onConfirm={(reason) => act.mutate({ action: reasonFor, reason })} />}
      {receiving && <ReceiveModal order={o} costingActive={Boolean(overview.data?.costingActive)} onClose={() => setReceiving(false)} onDone={() => { refresh(); setReceiving(false); }} />}
    </div>
  );
}

function ReceiveModal({ order, costingActive, onClose, onDone }: { order: PurchaseOrder; costingActive: boolean; onClose: () => void; onDone: () => void }) {
  const stockLines = order.lines.filter((l) => l.lineType === "STOCK");
  const [qty, setQty] = useState<Record<string, { accepted: string; rejected: string }>>(Object.fromEntries(stockLines.map((l) => [l.id, { accepted: String(l.qtyOpen), rejected: "0" }])));
  const [supplierRef, setSupplierRef] = useState("");
  const [overReason, setOverReason] = useState("");
  const lines = stockLines
    .map((l) => ({ l, accepted: Number(qty[l.id]?.accepted || 0), rejected: Number(qty[l.id]?.rejected || 0) }))
    .filter((x) => x.accepted + x.rejected > 0);
  const over = lines.some((x) => x.l.qtyReceived + x.accepted > x.l.qtyOrdered);
  const valid = lines.length > 0 && lines.every((x) => Number.isInteger(x.accepted) && Number.isInteger(x.rejected) && x.accepted >= 0 && x.rejected >= 0);
  const receive = useMutation({
    mutationFn: async (post: boolean) => {
      const grn = await purchasingApi.createGoodsReceipt({ purchaseOrderId: order.id, supplierRef: supplierRef.trim() || null, lines: lines.map((x) => ({ purchaseOrderLineId: x.l.id, qtyAccepted: x.accepted, qtyRejected: x.rejected })) });
      if (!post) return { grn, posted: false };
      const posted = await purchasingApi.postGoodsReceipt(grn.id, over ? overReason.trim() : null);
      return { grn: posted.receipt, posted: true };
    },
    onSuccess: ({ grn, posted }) => { toast.success(posted ? `${grn.number} posted — stock and its cost are in` : `${grn.number} saved as a draft`); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The receipt couldn't be saved")),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Receive goods — ${order.number}`}
      description="Only accepted units become stock. Rejected units are recorded and stay off the shelf."
      widthClassName="max-w-3xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="outline" loading={receive.isPending} disabled={!valid} onClick={() => receive.mutate(false)}>Save draft</Button>
          {costingActive && <Button loading={receive.isPending} disabled={!valid || (over && overReason.trim().length < 3)} onClick={() => receive.mutate(true)} data-testid="post-receipt">Post receipt</Button>}
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          {stockLines.map((l) => (
            <div key={l.id} className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-end gap-3 border-b border-line pb-2 last:border-0">
              <div className="min-w-0 text-sm">
                <span className="font-mono text-xs text-ink-600">{l.sku}</span>
                <span className="block truncate">{l.description}</span>
                <span className="text-xs text-ink-500">{l.qtyReceived} of {l.qtyOrdered} received</span>
              </div>
              <Field htmlFor={`acc-${l.id}`} label="Accepted"><Input id={`acc-${l.id}`} inputMode="numeric" value={qty[l.id]?.accepted ?? ""} onChange={(e) => setQty((q) => ({ ...q, [l.id]: { ...q[l.id]!, accepted: e.target.value } }))} /></Field>
              <Field htmlFor={`rej-${l.id}`} label="Rejected"><Input id={`rej-${l.id}`} inputMode="numeric" value={qty[l.id]?.rejected ?? ""} onChange={(e) => setQty((q) => ({ ...q, [l.id]: { ...q[l.id]!, rejected: e.target.value } }))} /></Field>
            </div>
          ))}
        </div>
        <Field htmlFor="grn-ref" label="Supplier delivery note / reference"><Input id="grn-ref" value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} maxLength={100} /></Field>
        {over && (
          <Field htmlFor="grn-over" label="Why accept more than ordered?" required hint="Receiving beyond the order needs an approver.">
            <Textarea id="grn-over" value={overReason} onChange={(e) => setOverReason(e.target.value)} rows={2} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
