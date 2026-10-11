"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { ReasonModal } from "@/components/admin/purchasing/reason-modal";
import { GRN_STATUS_BADGE, GRN_STATUS_LABEL } from "@/components/admin/purchasing/status";
import { VariantPicker } from "@/components/admin/purchasing/variant-picker";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as purchasingApi from "@/lib/api/purchasing";
import type { GoodsReceipt, PurchasableVariant } from "@/lib/api/purchasing";
import { formatPrice } from "@/lib/format";

/** Goods receipts (docs/FINANCE_PHASE_4D.md): what actually arrived. Posting one brings the stock and its cost in together;
 * a posted receipt never changes — a mistake is reversed. */
export default function GoodsReceiptsPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const allowed = can("purchasing.view");
  const [status, setStatus] = useState("");
  const purchaseOrderId = params.get("purchaseOrderId") ?? undefined;
  const query = { status: status || undefined, purchaseOrderId, pageSize: 100 };
  const list = useQuery({ queryKey: purchasingApi.purchasingDocKeys.receipts(query), queryFn: () => purchasingApi.listGoodsReceipts(query), enabled: allowed });
  const overview = useQuery({ queryKey: purchasingApi.purchasingKeys.status(), queryFn: purchasingApi.purchasingOverview, enabled: allowed });
  const [direct, setDirect] = useState(false);
  const [reversing, setReversing] = useState<GoodsReceipt | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: purchasingApi.purchasingKeys.all });

  const post = useMutation({
    mutationFn: (id: string) => purchasingApi.postGoodsReceipt(id),
    onSuccess: (r) => { refresh(); toast.success(`${r.receipt.number} posted`); },
    onError: (err) => toast.error(getErrorMessage(err, "The receipt couldn't be posted")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => purchasingApi.deleteGoodsReceipt(id),
    onSuccess: () => { refresh(); toast.success("Draft deleted"); },
    onError: (err) => toast.error(getErrorMessage(err, "The draft couldn't be deleted")),
  });
  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => purchasingApi.reverseGoodsReceipt(id, reason),
    onSuccess: (r) => { refresh(); setReversing(null); toast.success(`${r.receipt.number} reversed`); },
    onError: (err) => toast.error(getErrorMessage(err, "The receipt couldn't be reversed")),
  });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={PackageCheck} title="Purchasing isn't available to your role" />
      </div>
    );
  }
  const costingActive = Boolean(overview.data?.costingActive);
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Goods receipts"
        description="Deliveries from suppliers. Posting a receipt adds the accepted units to stock at their cost and records what you owe until the invoice arrives."
        action={can("purchasing.receive") && can("purchasing.approve") && <Button size="sm" variant="outline" onClick={() => setDirect(true)} data-testid="new-direct-receipt"><Plus className="h-4 w-4" /> Receipt without an order</Button>}
      />
      {overview.data && !costingActive && <Alert variant="info" title="Receipts post after the valuation cutover">Drafts can be prepared; posting waits until inventory costing is switched on (Finance → Valuation cutover).</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-44">
          <option value="">Every status</option>
          <option value="DRAFT">Draft</option>
          <option value="POSTED">Posted</option>
          <option value="REVERSED">Reversed</option>
        </Select>
        {purchaseOrderId && <Link href="/admin/finance/goods-receipts" className="text-sm underline-offset-4 hover:underline">Show every order&apos;s receipts</Link>}
      </div>
      {list.isLoading && <Skeleton className="h-40 w-full" />}
      {list.isError && <Alert variant="danger" title="Receipts couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => list.refetch()}>Retry</Button>}>{getErrorMessage(list.error, "")}</Alert>}
      {list.data?.goodsReceipts.length === 0 && <EmptyState icon={PackageCheck} title="No goods receipts" description="Receive goods from an approved purchase order." />}
      <div className="space-y-3">
        {list.data?.goodsReceipts.map((r) => (
          <Card key={r.id} className="space-y-3 p-4" data-testid="grn-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-sm text-ink-900">{r.number}</p>
                <p className="text-sm text-ink-600">
                  {r.supplier.displayName} · {r.receiptDate}
                  {r.purchaseOrder ? <> · <Link href={`/admin/finance/purchase-orders/${r.purchaseOrder.id}`} className="underline-offset-4 hover:underline">{r.purchaseOrder.number}</Link></> : " · no order"}
                  {r.supplierRef ? ` · ref ${r.supplierRef}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium tabular-nums">{formatPrice(r.total)}</span>
                <Badge variant={GRN_STATUS_BADGE[r.status]}>{GRN_STATUS_LABEL[r.status]}</Badge>
              </div>
            </div>
            <ul className="space-y-1 text-sm">
              {r.lines.map((l) => (
                <li key={l.id} className="flex flex-wrap justify-between gap-2">
                  <span className="min-w-0"><span className="font-mono text-xs text-ink-600">{l.sku}</span> {l.name}</span>
                  <span className="tabular-nums text-ink-700">{l.qtyAccepted} accepted{l.qtyRejected ? ` · ${l.qtyRejected} rejected` : ""} × {formatPrice(l.unitCost)}</span>
                </li>
              ))}
            </ul>
            {(r.directReason || r.overReceiptReason || r.reversalReason) && (
              <p className="text-xs text-ink-500">{[r.directReason && `Without an order: ${r.directReason}`, r.overReceiptReason && `Over-receipt: ${r.overReceiptReason}`, r.reversalReason && `Reversed: ${r.reversalReason}`].filter(Boolean).join(" · ")}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {r.status === "DRAFT" && can("purchasing.receive") && costingActive && <Button size="sm" loading={post.isPending} onClick={() => post.mutate(r.id)}>Post</Button>}
              {r.status === "DRAFT" && can("purchasing.receive") && <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate(r.id)}>Delete draft</Button>}
              {r.status === "POSTED" && can("purchasing.approve") && <Button size="sm" variant="outline" onClick={() => setReversing(r)}>Reverse</Button>}
            </div>
          </Card>
        ))}
      </div>
      {direct && <DirectReceiptModal costingActive={costingActive} onClose={() => setDirect(false)} onDone={() => { refresh(); setDirect(false); }} />}
      {reversing && <ReasonModal title={`Reverse ${reversing.number}`} hint="The accepted units leave stock again at this receipt's cost and its journal is reversed. Units already sold can't be reversed — return them to the supplier instead." loading={reverse.isPending} onClose={() => setReversing(null)} onConfirm={(reason) => reverse.mutate({ id: reversing.id, reason })} />}
    </div>
  );
}

interface DirectLine { key: number; variant: PurchasableVariant | null; qty: string; cost: string }
let k = 0;

function DirectReceiptModal({ costingActive, onClose, onDone }: { costingActive: boolean; onClose: () => void; onDone: () => void }) {
  const [supplierId, setSupplierId] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [lines, setLines] = useState<DirectLine[]>([{ key: ++k, variant: null, qty: "1", cost: "" }]);
  const suppliers = useQuery({ queryKey: purchasingApi.purchasingKeys.suppliers({ status: "ACTIVE" }), queryFn: () => purchasingApi.listSuppliers({ status: "ACTIVE", pageSize: 200 }) });
  const set = (key: number, patch: Partial<DirectLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const valid = supplierId && reason.trim().length >= 3 && lines.every((l) => l.variant && Number.isInteger(Number(l.qty)) && Number(l.qty) >= 1 && l.cost.trim() !== "" && Number(l.cost) >= 0);
  const save = useMutation({
    mutationFn: async (post: boolean) => {
      const grn = await purchasingApi.createGoodsReceipt({ supplierId, directReason: reason.trim(), evidence: evidence.trim() || null, lines: lines.map((l) => ({ variantId: l.variant!.id, qtyAccepted: Number(l.qty), unitCost: Number(l.cost) })) });
      return post ? (await purchasingApi.postGoodsReceipt(grn.id)).receipt : grn;
    },
    onSuccess: (r) => { toast.success(`${r.number} ${r.status === "POSTED" ? "posted" : "saved as a draft"}`); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The receipt couldn't be saved")),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Receipt without a purchase order"
      description="An exception: it needs a reason, evidence and an approver, and is reported as such."
      widthClassName="max-w-2xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="outline" loading={save.isPending} disabled={!valid} onClick={() => save.mutate(false)}>Save draft</Button>{costingActive && <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate(true)} data-testid="post-direct">Post</Button>}</>}
    >
      <div className="space-y-4">
        <Field htmlFor="dr-supplier" label="Supplier" required>
          <Select id="dr-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Choose…</option>
            {suppliers.data?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.displayName} ({s.code})</option>)}
          </Select>
        </Field>
        {lines.map((l, i) => (
          <div key={l.key} className="space-y-2 rounded-xl border border-line p-3">
            <div className="flex items-center justify-between"><span className="text-sm font-medium">Line {i + 1}</span>{lines.length > 1 && <IconButton aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="h-4 w-4" /></IconButton>}</div>
            <VariantPicker value={l.variant} onChange={(variant) => set(l.key, { variant })} label={`Line ${i + 1} variant`} />
            <div className="grid grid-cols-2 gap-3">
              <Field htmlFor={`dq-${l.key}`} label="Units received"><Input id={`dq-${l.key}`} inputMode="numeric" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} /></Field>
              <Field htmlFor={`dc-${l.key}`} label="Actual unit cost"><Input id={`dc-${l.key}`} inputMode="decimal" value={l.cost} onChange={(e) => set(l.key, { cost: e.target.value })} /></Field>
            </div>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, { key: ++k, variant: null, qty: "1", cost: "" }])}><Plus className="h-4 w-4" /> Line</Button>
        <Field htmlFor="dr-reason" label="Why no purchase order?" required><Textarea id="dr-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
        <Field htmlFor="dr-evidence" label="Evidence" hint="Cash memo, invoice or delivery note reference."><Input id="dr-evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={500} /></Field>
      </div>
    </Modal>
  );
}
