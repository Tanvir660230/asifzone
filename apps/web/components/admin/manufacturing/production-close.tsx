"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, CircleAlert } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api-client";
import * as mfg from "@/lib/api/manufacturing";
import type { ProductionOrder, ProductionSettlement } from "@/lib/api/manufacturing";
import { formatPrice } from "@/lib/format";

const pct = (v: number | null) => (v === null ? "—" : `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`);

/** Closing a production order and its final cost (docs/MANUFACTURING.md §9): what still blocks the close, the close itself
 * (with an optional approved abnormal loss), and — once closed — the final cost sheet and every settlement it made. */
export function ProductionClose({ order, canClose, onChanged }: { order: ProductionOrder; canClose: boolean; onChanged: () => void }) {
  const [closing, setClosing] = useState(false);
  const inProduction = ["IN_PRODUCTION", "PARTIALLY_RECEIVED", "RECEIVED"].includes(order.status);
  const closed = order.status === "CLOSED";
  if (!inProduction && !closed) return null;
  const c = order.closeChecklist;
  const items = [
    { ok: !c.materialsAtProducer.length, label: c.materialsAtProducer.length ? `Material still with the producer: ${c.materialsAtProducer.map((m) => `${m.sku} (${m.atProducer.toLocaleString()})`).join(", ")} — return it or record its usage` : "All issued material is returned, used or scrapped" },
    { ok: !c.draftCosts, label: c.draftCosts ? `${c.draftCosts} production cost${c.draftCosts === 1 ? "" : "s"} waiting for approval — approve or void` : "Every production cost is approved or voided" },
    { ok: !c.draftReceipts, label: c.draftReceipts ? `${c.draftReceipts} draft deliver${c.draftReceipts === 1 ? "y" : "ies"} — post or delete` : "No draft deliveries" },
  ];
  const ready = items.every((i) => i.ok);
  const f = order.finalCost;
  const p = order.performance;

  return (
    <section className="space-y-3" data-testid="mo-close-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink-900">{closed ? "Final cost" : "Close the order"}</h2>
        {inProduction && canClose && <Button size="sm" disabled={!ready} onClick={() => setClosing(true)} data-testid="mo-close">Close order…</Button>}
      </div>

      {inProduction && (
        <Card className="space-y-2 p-4 text-sm">
          <p className="text-ink-600">Closing fixes the order&apos;s final cost: what is left in work in progress moves to the finished goods (units still in stock are revalued, the share already sold goes to cost of sales). Late costs can still be added afterwards.</p>
          <ul className="space-y-1.5">
            {items.map((i) => (
              <li key={i.label} className="flex items-start gap-2">
                {i.ok ? <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success-700" /> : <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning-700" />}
                <span className={i.ok ? "text-ink-700" : "text-ink-900"}>{i.label}</span>
              </li>
            ))}
          </ul>
          {order.wip && <p className="text-ink-600">Left in work in progress: <span className="font-medium tabular-nums text-ink-900">{formatPrice(order.wip.total)}</span></p>}
        </Card>
      )}

      {closed && (
        <div className="grid gap-3 lg:grid-cols-2">
          {f && (
            <Card className="divide-y divide-line p-0 text-sm" data-testid="mo-final-cost">
              <Row label="Final cost (materials + approved costs)" value={formatPrice(f.total)} strong />
              {f.abnormalLoss > 0 && <Row label="Abnormal loss written off" value={`−${formatPrice(f.abnormalLoss)}`} />}
              <Row label="Cost of the finished goods" value={formatPrice(f.goods)} />
              <Row label="Per accepted unit" value={f.perAcceptedUnit === null ? "—" : formatPrice(f.perAcceptedUnit)} hint={order.planned && order.planned.costPerUnit && !order.planned.materialsWithoutCost ? `planned ${formatPrice(order.planned.costPerUnit)}` : undefined} strong />
              <Row label="Per delivered unit (incl. rejects)" value={f.perDeliveredUnit === null ? "—" : formatPrice(f.perDeliveredUnit)} />
              {f.materialWastage > 0 && <Row label="Material scrapped" value={formatPrice(f.materialWastage)} />}
            </Card>
          )}
          <Card className="divide-y divide-line p-0 text-sm">
            <Row label="Yield (accepted ÷ delivered)" value={pct(p.yieldPct)} />
            <Row label="Rejected" value={pct(p.rejectionPct)} />
            <Row label="Sent back for rework" value={pct(p.reworkPct)} />
            <Row label="Of the plan accepted" value={pct(p.fulfilmentPct)} />
            {p.materialWastagePct !== null && <Row label="Material wastage" value={pct(p.materialWastagePct)} />}
            {p.onTime !== null && <Row label="Delivered by the expected date" value={p.onTime ? "Yes" : "No — late"} />}
          </Card>
        </div>
      )}

      {f && f.settlements.length > 0 && (
        <Card className="divide-y divide-line p-0 text-sm" data-testid="mo-settlements">
          {f.settlements.map((s) => <SettlementRow key={s.id} s={s} />)}
        </Card>
      )}
      {closed && order.closedReason && <p className="text-sm text-ink-600">Close note: {order.closedReason}</p>}

      {closing && <CloseModal order={order} onClose={() => setClosing(false)} onDone={() => { setClosing(false); onChanged(); }} />}
    </section>
  );
}

function SettlementRow({ s }: { s: ProductionSettlement }) {
  const title = s.kind === "CLOSE" ? "Closed" : s.transfer < 0 || s.residual < 0 ? "Late cost voided" : "Late cost";
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5">
      <div className="min-w-0">
        <p className="font-medium text-ink-900">{title} <span className="font-normal text-ink-500">· {new Date(s.createdAt).toLocaleString()}</span></p>
        {s.transfer !== 0 && (
          <p className="text-ink-600">
            To the finished goods {formatPrice(s.transfer)} — {formatPrice(s.heldShare)} revalues the units in stock{s.soldShare !== 0 ? `, ${formatPrice(s.soldShare)} to cost of sales for units already sold` : ""}
          </p>
        )}
        {s.abnormalLoss > 0 && <p className="text-ink-600">Abnormal loss {formatPrice(s.abnormalLoss)}{s.abnormalLossReason ? ` — ${s.abnormalLossReason}` : ""}</p>}
      </div>
      <span className="whitespace-nowrap tabular-nums text-ink-900">{formatPrice(s.residual)}</span>
    </div>
  );
}

function Row({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
      <span className="text-ink-700">{label}</span>
      <span className={strong ? "text-right font-semibold tabular-nums text-ink-900" : "text-right tabular-nums text-ink-900"}>
        {value}
        {hint && <span className="block text-xs font-normal text-ink-500">{hint}</span>}
      </span>
    </div>
  );
}

function CloseModal({ order, onClose, onDone }: { order: ProductionOrder; onClose: () => void; onDone: () => void }) {
  const [loss, setLoss] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const left = order.wip?.total ?? 0;
  const lossValue = loss.trim() ? Number(loss) : 0;
  const lossInvalid = !Number.isFinite(lossValue) || lossValue < 0 || lossValue > Math.max(0, left);
  const needsReason = lossValue > 0 && reason.trim().length < 3;
  const close = useMutation({
    mutationFn: () => mfg.closeProductionOrder(order.id, { abnormalLoss: lossValue || null, abnormalLossReason: lossValue ? reason.trim() : null, note: note.trim() || null }),
    onSuccess: (o) => { toast.success(`${o.number} closed at its final cost`); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The order couldn't be closed")),
  });
  const toGoods = Math.round((left - (lossInvalid ? 0 : lossValue)) * 100) / 100;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Close ${order.number}`}
      description="The final cost is fixed and the order is closed for deliveries and materials."
      widthClassName="max-w-lg"
      footer={<><Button variant="outline" onClick={onClose}>Back</Button><Button loading={close.isPending} disabled={lossInvalid || needsReason} onClick={() => close.mutate()} data-testid="confirm-close">Close order</Button></>}
    >
      <div className="space-y-4 text-sm">
        <Card className="divide-y divide-line p-0">
          <Row label="Left in work in progress" value={formatPrice(left)} />
          <Row label="Goes to the finished goods (by accepted units)" value={formatPrice(toGoods)} strong />
        </Card>
        {order.progress.accepted === 0 && left !== 0 && <Alert variant="warning" title="No finished goods were accepted">What is left can only be written off as an abnormal loss.</Alert>}
        <Field htmlFor="abnormal-loss" label="Abnormal loss (optional)" hint="Cost lost beyond normal wastage — fire, theft, a spoiled lot. Written off to production losses instead of the goods' cost." error={lossInvalid ? `Between 0 and ${formatPrice(Math.max(0, left))}` : undefined}>
          <Input id="abnormal-loss" inputMode="decimal" value={loss} onChange={(e) => setLoss(e.target.value)} placeholder="0" data-testid="abnormal-loss" />
        </Field>
        {lossValue > 0 && (
          <Field htmlFor="abnormal-reason" label="Why is the loss abnormal?" required>
            <Textarea id="abnormal-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="abnormal-reason" />
          </Field>
        )}
        <Field htmlFor="close-note" label="Note (optional)">
          <Textarea id="close-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
