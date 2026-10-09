"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Undo2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { ReasonModal } from "@/components/admin/purchasing/reason-modal";
import { RETURN_STATUS_BADGE, RETURN_STATUS_LABEL } from "@/components/admin/purchasing/status";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as purchasingApi from "@/lib/api/purchasing";
import type { PurchaseReturn } from "@/lib/api/purchasing";
import { formatPrice } from "@/lib/format";

/** Supplier returns (docs/FINANCE_PHASE_4D.md): goods sent back. Shipping one takes the units out of stock at their average
 * cost; the supplier's credit, replacement or refund follows on the invoice side. */
export default function SupplierReturnsPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("purchasing.view");
  const [status, setStatus] = useState("");
  const query = { status: status || undefined, pageSize: 100 };
  const list = useQuery({ queryKey: purchasingApi.purchasingDocKeys.returns(query), queryFn: () => purchasingApi.listPurchaseReturns(query), enabled: allowed });
  const overview = useQuery({ queryKey: purchasingApi.purchasingKeys.status(), queryFn: purchasingApi.purchasingOverview, enabled: allowed });
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<PurchaseReturn | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: purchasingApi.purchasingKeys.all });
  const act = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: "approve" | "reopen" | "cancel" | "ship"; reason?: string }) => purchasingApi.purchaseReturnAction(id, action, reason),
    onSuccess: (_r, v) => { refresh(); setCancelling(null); toast.success({ approve: "Return approved", reopen: "Back to draft", cancel: "Return cancelled", ship: "Return shipped — stock and value are out" }[v.action]); },
    onError: (err) => toast.error(getErrorMessage(err, "That didn't work")),
  });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={Undo2} title="Purchasing isn't available to your role" />
      </div>
    );
  }
  const costingActive = Boolean(overview.data?.costingActive);
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Supplier returns"
        description="Goods sent back to a supplier. Shipping a return takes the units out of stock at their average cost; what the supplier owes you back is settled on the invoice side."
        action={can("purchasing.manage") && <Button size="sm" onClick={() => setCreating(true)} data-testid="new-return"><Plus className="h-4 w-4" /> New return</Button>}
      />
      <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-44">
        <option value="">Every status</option>
        {(Object.keys(RETURN_STATUS_LABEL) as Array<keyof typeof RETURN_STATUS_LABEL>).map((s) => <option key={s} value={s}>{RETURN_STATUS_LABEL[s]}</option>)}
      </Select>
      {list.isLoading && <Skeleton className="h-40 w-full" />}
      {list.isError && <Alert variant="danger" title="Returns couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => list.refetch()}>Retry</Button>}>{getErrorMessage(list.error, "")}</Alert>}
      {list.data?.purchaseReturns.length === 0 && <EmptyState icon={Undo2} title="No supplier returns" description="Create one when goods go back to a supplier." />}
      <div className="space-y-3">
        {list.data?.purchaseReturns.map((r) => (
          <Card key={r.id} className="space-y-3 p-4" data-testid="return-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-sm text-ink-900">{r.number}</p>
                <p className="text-sm text-ink-600">{r.supplier.displayName} · {r.returnDate} · {r.reason}</p>
              </div>
              <div className="flex items-center gap-2">
                {r.total !== null && <span className="text-sm font-medium tabular-nums">{formatPrice(r.total)}</span>}
                <Badge variant={RETURN_STATUS_BADGE[r.status]}>{RETURN_STATUS_LABEL[r.status]}</Badge>
              </div>
            </div>
            <ul className="space-y-1 text-sm">
              {r.lines.map((l) => (
                <li key={l.id} className="flex flex-wrap justify-between gap-2">
                  <span className="min-w-0"><span className="font-mono text-xs text-ink-600">{l.sku}</span> {l.name}{l.goodsReceipt ? <span className="text-xs text-ink-500"> · from {l.goodsReceipt.number}</span> : null}</span>
                  <span className="tabular-nums text-ink-700">{l.quantity}{l.value !== null ? ` · ${formatPrice(l.value)}` : ""}</span>
                </li>
              ))}
            </ul>
            {r.cancelledReason && <p className="text-xs text-ink-500">Cancelled: {r.cancelledReason}</p>}
            <div className="flex flex-wrap gap-2">
              {r.status === "DRAFT" && can("purchasing.approve") && <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ id: r.id, action: "approve" })}>Approve</Button>}
              {r.status === "APPROVED" && can("purchasing.receive") && costingActive && <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ id: r.id, action: "ship" })} data-testid="ship-return">Ship</Button>}
              {r.status === "APPROVED" && can("purchasing.manage") && <Button size="sm" variant="outline" onClick={() => act.mutate({ id: r.id, action: "reopen" })}>Back to draft</Button>}
              {(r.status === "DRAFT" || r.status === "APPROVED") && can("purchasing.manage") && <Button size="sm" variant="ghost" onClick={() => setCancelling(r)}>Cancel</Button>}
            </div>
          </Card>
        ))}
      </div>
      {creating && <ReturnModal onClose={() => setCreating(false)} onDone={() => { refresh(); setCreating(false); }} />}
      {cancelling && <ReasonModal title={`Cancel ${cancelling.number}`} loading={act.isPending} onClose={() => setCancelling(null)} onConfirm={(reason) => act.mutate({ id: cancelling.id, action: "cancel", reason })} />}
    </div>
  );
}

/** A return lists units from the supplier's posted receipts — so it can never return more than was received. */
function ReturnModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [supplierId, setSupplierId] = useState("");
  const [reason, setReason] = useState("");
  const [picked, setPicked] = useState<Array<{ goodsReceiptLineId: string; label: string; max: number; quantity: string }>>([]);
  const suppliers = useQuery({ queryKey: purchasingApi.purchasingKeys.suppliers({}), queryFn: () => purchasingApi.listSuppliers({ pageSize: 200 }) });
  const receipts = useQuery({ queryKey: purchasingApi.purchasingDocKeys.receipts({ status: "POSTED", supplierId }), queryFn: () => purchasingApi.listGoodsReceipts({ status: "POSTED", pageSize: 100 }), enabled: Boolean(supplierId) });
  const available = (receipts.data?.goodsReceipts ?? []).filter((g) => g.supplier.id === supplierId).flatMap((g) => g.lines.filter((l) => l.qtyAccepted > 0).map((l) => ({ id: l.id, label: `${g.number} · ${l.sku} ${l.name}`, max: l.qtyAccepted })));
  const valid = supplierId && reason.trim().length >= 3 && picked.length > 0 && picked.every((p) => Number.isInteger(Number(p.quantity)) && Number(p.quantity) >= 1 && Number(p.quantity) <= p.max);
  const save = useMutation({
    mutationFn: () => purchasingApi.createPurchaseReturn({ supplierId, reason: reason.trim(), lines: picked.map((p) => ({ goodsReceiptLineId: p.goodsReceiptLineId, quantity: Number(p.quantity) })) }),
    onSuccess: (r) => { toast.success(`${r.number} saved as a draft`); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The return couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title="New supplier return" widthClassName="max-w-2xl" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="save-return">Save draft</Button></>}>
      <div className="space-y-4">
        <Field htmlFor="rt-supplier" label="Supplier" required>
          <Select id="rt-supplier" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setPicked([]); }}>
            <option value="">Choose…</option>
            {suppliers.data?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.displayName} ({s.code})</option>)}
          </Select>
        </Field>
        {supplierId && (
          <Field htmlFor="rt-add" label="Add units from a receipt">
            <Select id="rt-add" value="" onChange={(e) => { const a = available.find((x) => x.id === e.target.value); if (a && !picked.some((p) => p.goodsReceiptLineId === a.id)) setPicked((ps) => [...ps, { goodsReceiptLineId: a.id, label: a.label, max: a.max, quantity: "1" }]); }}>
              <option value="">{receipts.isLoading ? "Loading receipts…" : available.length ? "Choose a received line…" : "No posted receipts from this supplier"}</option>
              {available.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.max} accepted)</option>)}
            </Select>
          </Field>
        )}
        {picked.map((p) => (
          <div key={p.goodsReceiptLineId} className="flex items-end gap-3">
            <p className="min-w-0 flex-1 truncate pb-2 text-sm">{p.label}</p>
            <Field htmlFor={`rq-${p.goodsReceiptLineId}`} label={`Units (max ${p.max})`} className="w-28"><Input id={`rq-${p.goodsReceiptLineId}`} inputMode="numeric" value={p.quantity} onChange={(e) => setPicked((ps) => ps.map((x) => (x.goodsReceiptLineId === p.goodsReceiptLineId ? { ...x, quantity: e.target.value } : x)))} /></Field>
            <IconButton aria-label="Remove" onClick={() => setPicked((ps) => ps.filter((x) => x.goodsReceiptLineId !== p.goodsReceiptLineId))}><Trash2 className="h-4 w-4" /></IconButton>
          </div>
        ))}
        <Field htmlFor="rt-reason" label="Why is it going back?" required><Textarea id="rt-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
      </div>
    </Modal>
  );
}
