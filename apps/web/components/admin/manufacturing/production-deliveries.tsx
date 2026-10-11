"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { PackageCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ReasonModal } from "@/components/admin/purchasing/reason-modal";
import { formatUnitCost } from "@/components/admin/manufacturing/format";
import { getErrorMessage } from "@/lib/api-client";
import * as mfg from "@/lib/api/manufacturing";
import type { ProductionOrder, ProductionReceiptSummary } from "@/lib/api/manufacturing";
import { formatPrice } from "@/lib/format";

const STATUS = { DRAFT: { variant: "neutral", label: "draft" }, POSTED: { variant: "success", label: "in stock" }, REVERSED: { variant: "neutral", label: "reversed" } } as const;

/** Deliveries from production and their inspection (docs/MANUFACTURING.md §8): what arrived, what was accepted into stock,
 * rejected or sent back for rework — per size and colour, against the plan. */
export function ProductionDeliveries({ order, can, onChanged }: { order: ProductionOrder; can: (c: "manufacturing.manage" | "manufacturing.move_stock" | "manufacturing.approve") => boolean; onChanged: () => void }) {
  const [recording, setRecording] = useState(false);
  const [reversing, setReversing] = useState<ProductionReceiptSummary | null>(null);
  const receivable = ["APPROVED", "IN_PRODUCTION", "PARTIALLY_RECEIVED", "RECEIVED"].includes(order.status);
  const post = useMutation({
    mutationFn: (id: string) => mfg.postProductionReceipt(id),
    onSuccess: (r) => { onChanged(); toast.success(`${r.receipt.number} posted — accepted units are in stock`); },
    onError: (err) => toast.error(getErrorMessage(err, "The delivery couldn't be posted")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => mfg.deleteProductionReceipt(id),
    onSuccess: () => { onChanged(); toast.success("Draft deleted"); },
    onError: (err) => toast.error(getErrorMessage(err, "The draft couldn't be deleted")),
  });
  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => mfg.reverseProductionReceipt(id, reason),
    onSuccess: () => { onChanged(); setReversing(null); toast.success("Delivery reversed"); },
    onError: (err) => toast.error(getErrorMessage(err, "The delivery couldn't be reversed")),
  });
  const p = order.progress;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink-900">Deliveries</h2>
        {can("manufacturing.manage") && receivable && <Button size="sm" onClick={() => setRecording(true)} data-testid="record-delivery"><PackageCheck className="h-4 w-4" /> Record delivery</Button>}
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="mo-progress">
        {([["Planned", p.planned], ["Delivered", p.delivered], ["Accepted", p.accepted], ["Rejected", p.rejected], ["Still due", p.outstanding]] as const).map(([label, n]) => (
          <Card key={label} className="p-3">
            <dt className="text-xs text-ink-600">{label}</dt>
            <dd className={label === "Rejected" && n > 0 ? "text-lg font-semibold tabular-nums text-danger-700" : "text-lg font-semibold tabular-nums text-ink-900"}>{n.toLocaleString()}</dd>
          </Card>
        ))}
      </dl>
      {order.lines.length > 1 && p.delivered > 0 && (
        <Card className="overflow-hidden p-0">
          <HScrollShadow>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Size / colour</TableHeaderCell>
                  <TableHeaderCell align="right">Planned</TableHeaderCell>
                  <TableHeaderCell align="right">Accepted</TableHeaderCell>
                  <TableHeaderCell align="right">Rejected</TableHeaderCell>
                  <TableHeaderCell align="right">Rework</TableHeaderCell>
                  <TableHeaderCell align="right">Still due</TableHeaderCell>
                </tr>
              </TableHead>
              <tbody>
                {order.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.size} / {l.color || "—"}</TableCell>
                    <TableCell align="right" className="tabular-nums">{l.plannedQty}</TableCell>
                    <TableCell align="right" className="tabular-nums">{l.acceptedQty}</TableCell>
                    <TableCell align="right" className={l.rejectedQty ? "tabular-nums text-danger-700" : "tabular-nums"}>{l.rejectedQty}</TableCell>
                    <TableCell align="right" className="tabular-nums">{l.reworkQty}</TableCell>
                    <TableCell align="right" className="tabular-nums">{l.outstanding}</TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </HScrollShadow>
        </Card>
      )}
      {order.receipts.length > 0 ? (
        <Card className="divide-y divide-line p-0 text-sm" data-testid="receipt-list">
          {order.receipts.map((r) => (
            <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-mono text-xs text-ink-900">{r.number}<span className="ml-2 font-sans text-ink-600">{r.receiptDate}{r.deliveryRef ? ` · ref ${r.deliveryRef}` : ""}</span></p>
                <p className="text-xs text-ink-600">{r.delivered} delivered · {r.accepted} accepted{r.rejected ? ` · ${r.rejected} rejected` : ""}{r.rework ? ` · ${r.rework} rework` : ""}{r.inspectionNotes ? ` · ${r.inspectionNotes}` : ""}{r.reversalReason ? ` · reversed: ${r.reversalReason}` : ""}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {r.value !== null && <span className="tabular-nums">{formatPrice(r.value)}{r.provisionalUnitCost !== null ? <span className="ml-1 text-xs text-ink-500">({formatUnitCost(r.provisionalUnitCost, "unit")}, provisional)</span> : null}</span>}
                <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                {r.status === "DRAFT" && can("manufacturing.move_stock") && <Button size="sm" loading={post.isPending} onClick={() => post.mutate(r.id)} data-testid="post-delivery">Post to stock</Button>}
                {r.status === "DRAFT" && can("manufacturing.manage") && <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate(r.id)}>Delete</Button>}
                {r.status === "POSTED" && can("manufacturing.approve") && receivable && <Button size="sm" variant="ghost" onClick={() => setReversing(r)}>Reverse</Button>}
              </div>
            </div>
          ))}
        </Card>
      ) : (
        <p className="text-sm text-ink-600">Nothing delivered yet.</p>
      )}
      {recording && <DeliveryModal order={order} canPost={can("manufacturing.move_stock")} canApprove={can("manufacturing.approve")} onClose={() => setRecording(false)} onDone={() => { onChanged(); setRecording(false); }} />}
      {reversing && <ReasonModal title={`Reverse ${reversing.number}`} hint="The accepted units leave stock again at this delivery's cost. Units already sold can't be reversed." loading={reverse.isPending} onClose={() => setReversing(null)} onConfirm={(reason) => reverse.mutate({ id: reversing.id, reason })} />}
    </section>
  );
}

type Row = { delivered: string; accepted: string; rejected: string; rework: string; reason: string };
const n = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : s.trim() === "" ? 0 : NaN);

function DeliveryModal({ order, canPost, canApprove, onClose, onDone }: { order: ProductionOrder; canPost: boolean; canApprove: boolean; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, Row>>(Object.fromEntries(order.lines.map((l) => [l.id, { delivered: "", accepted: "", rejected: "", rework: "", reason: "" }])));
  const [deliveryRef, setDeliveryRef] = useState("");
  const [notes, setNotes] = useState("");
  const [overReason, setOverReason] = useState("");
  const parsed = order.lines.map((l) => {
    const r = rows[l.id]!;
    const accepted = n(r.accepted), rejected = n(r.rejected), rework = n(r.rework);
    const delivered = r.delivered.trim() === "" ? accepted + rejected + rework : n(r.delivered);
    return { l, r, delivered, accepted, rejected, rework };
  }).filter((x) => x.delivered > 0 || Number.isNaN(x.delivered));
  const bad = parsed.filter((x) => [x.delivered, x.accepted, x.rejected, x.rework].some(Number.isNaN) || x.delivered !== x.accepted + x.rejected + x.rework || (x.rejected > 0 && x.r.reason.trim().length < 2));
  const over = parsed.filter((x) => x.l.acceptedQty + x.accepted > x.l.plannedQty);
  const set = (id: string, patch: Partial<Row>) => setRows((rs) => ({ ...rs, [id]: { ...rs[id]!, ...patch } }));
  const save = useMutation({
    mutationFn: async (andPost: boolean) => {
      const r = await mfg.createProductionReceipt(order.id, { deliveryRef: deliveryRef.trim() || null, inspectionNotes: notes.trim() || null, lines: parsed.map((x) => ({ orderLineId: x.l.id, delivered: x.delivered, accepted: x.accepted, rejected: x.rejected, rework: x.rework, rejectReason: x.r.reason.trim() || null })) });
      if (!andPost) return { number: r.number, posted: false };
      const p = await mfg.postProductionReceipt(r.id, over.length ? overReason.trim() : null);
      return { number: p.receipt.number, posted: true };
    },
    onSuccess: (r) => { toast.success(r.posted ? `${r.number} posted — accepted units are in stock` : `${r.number} saved as a draft`); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The delivery couldn't be saved")),
  });
  const ready = parsed.length > 0 && bad.length === 0;
  return (
    <Modal open onClose={onClose} title={`Record delivery — ${order.number}`} description="Inspect each size and colour: only accepted units go into stock. Delivered = accepted + rejected + sent back for rework." widthClassName="max-w-4xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="outline" loading={save.isPending} disabled={!ready} onClick={() => save.mutate(false)}>Save draft</Button>{canPost && <Button loading={save.isPending} disabled={!ready || (over.length > 0 && (!canApprove || overReason.trim().length < 3))} onClick={() => save.mutate(true)} data-testid="post-receipt">Post to stock</Button>}</>}>
      <div className="space-y-4">
        <div className="overflow-hidden rounded-xl border border-line">
          <HScrollShadow>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Size / colour</TableHeaderCell>
                  <TableHeaderCell align="right">Due</TableHeaderCell>
                  <TableHeaderCell align="right">Accepted</TableHeaderCell>
                  <TableHeaderCell align="right">Rejected</TableHeaderCell>
                  <TableHeaderCell align="right">Rework</TableHeaderCell>
                  <TableHeaderCell>Reason for rejects</TableHeaderCell>
                </tr>
              </TableHead>
              <tbody>
                {order.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap">{l.size} / {l.color || "—"}</TableCell>
                    <TableCell align="right" className="tabular-nums">{l.outstanding}</TableCell>
                    {(["accepted", "rejected", "rework"] as const).map((k) => (
                      <TableCell key={k} align="right"><Input aria-label={`${l.size} ${l.color} ${k}`} inputMode="numeric" className="ml-auto w-20 text-right tabular-nums" placeholder="0" value={rows[l.id]![k]} onChange={(e) => set(l.id, { [k]: e.target.value })} data-testid={`${k}-${l.sku}`} /></TableCell>
                    ))}
                    <TableCell><Input aria-label={`${l.size} ${l.color} reject reason`} className="min-w-40" value={rows[l.id]!.reason} onChange={(e) => set(l.id, { reason: e.target.value })} disabled={!(n(rows[l.id]!.rejected) > 0)} /></TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </HScrollShadow>
        </div>
        {bad.length > 0 && <Alert variant="danger" title="Check the quantities">{bad.map((x) => `${x.l.size} / ${x.l.color}`).join(", ")}: whole numbers, and a reason for any rejects.</Alert>}
        {over.length > 0 && (canApprove
          ? <Field htmlFor="dl-over" label="Why accept more than planned?" required><Textarea id="dl-over" rows={2} value={overReason} onChange={(e) => setOverReason(e.target.value)} /></Field>
          : <Alert variant="warning" title="More than planned">Accepting beyond the plan needs an approver — save it as a draft.</Alert>)}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field htmlFor="dl-ref" label="Delivery note / challan"><Input id="dl-ref" value={deliveryRef} onChange={(e) => setDeliveryRef(e.target.value)} maxLength={100} /></Field>
          <Field htmlFor="dl-notes" label="Inspection notes"><Input id="dl-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="e.g. AQL 2.5, stitching checked" /></Field>
        </div>
      </div>
    </Modal>
  );
}
