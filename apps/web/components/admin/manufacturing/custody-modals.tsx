"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api-client";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";
import * as mfg from "@/lib/api/manufacturing";
import type { ProductionOrder } from "@/lib/api/manufacturing";

const whole = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);

/** Issue business-supplied material to the order (stock → work in progress). Defaults to what the plan still needs. */
export function IssueModal({ order, canApprove, onClose, onDone }: { order: ProductionOrder; canApprove: boolean; onClose: () => void; onDone: () => void }) {
  const lines = order.materials.filter((m) => m.suppliedBy === "BUSINESS");
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(lines.map((m) => [m.id, String(Math.max(0, Math.min(m.plannedQty - m.issuedQty + m.returnedQty, m.inStock)))])));
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const chosen = lines.map((m) => ({ m, n: whole(qty[m.id] ?? "0") })).filter((x) => x.n > 0);
  const over = chosen.filter((x) => x.m.issuedQty - x.m.returnedQty + x.n > x.m.plannedQty);
  const short = chosen.filter((x) => x.n > x.m.inStock);
  const invalid = lines.some((m) => Number.isNaN(whole(qty[m.id] ?? "0")));
  const body = { lines: chosen.map((x) => ({ materialLineId: x.m.id, quantity: x.n })), note: note.trim() || null, overIssueReason: over.length ? reason.trim() : null };
  const scope = `mo-issue:${order.id}`;
  const issue = useMutation({
    mutationFn: () => mfg.issueMaterials(order.id, body, idempotencyKeyFor(scope, body)),
    onSuccess: (o) => { settleIdempotencyKey(scope); toast.success(o.replayed ? "Already issued" : "Materials issued — they're now in work in progress"); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The materials couldn't be issued")),
  });
  return (
    <Modal open onClose={onClose} title={`Issue materials — ${order.number}`} description="The material leaves stock at its average cost and is held as work in progress for this order." widthClassName="max-w-2xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={issue.isPending} disabled={invalid || !chosen.length || short.length > 0 || (over.length > 0 && (!canApprove || reason.trim().length < 3))} onClick={() => issue.mutate()} data-testid="confirm-issue">Issue</Button></>}>
      <div className="space-y-3">
        {lines.length === 0 && <p className="text-sm text-ink-600">Every material on this order is supplied by the producer.</p>}
        {lines.map((m) => (
          <div key={m.id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-end gap-3 border-b border-line pb-2 last:border-0">
            <div className="min-w-0 text-sm">
              <span className="font-mono text-xs text-ink-600">{m.sku}</span>
              <span className="block truncate">{m.name}</span>
              <span className="text-xs text-ink-500">planned {m.plannedQty.toLocaleString()} · issued {(m.issuedQty - m.returnedQty).toLocaleString()} · in stock {m.inStock.toLocaleString()} {m.stockUnit}</span>
            </div>
            <Field htmlFor={`iss-${m.id}`} label={m.stockUnit}><Input id={`iss-${m.id}`} inputMode="numeric" value={qty[m.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [m.id]: e.target.value }))} /></Field>
          </div>
        ))}
        {short.length > 0 && <Alert variant="danger" title="Not enough in stock">{short.map((x) => x.m.sku).join(", ")} — receive more before issuing.</Alert>}
        {over.length > 0 && (canApprove ? (
          <Field htmlFor="iss-reason" label="Why issue more than planned?" required><Textarea id="iss-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        ) : (
          <Alert variant="warning" title="More than planned">Issuing beyond the plan needs an approver.</Alert>
        ))}
        <Field htmlFor="iss-note" label="Note"><Input id="iss-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. first cutting batch" /></Field>
      </div>
    </Modal>
  );
}

/** Return unused material from the producer to stock, at the order's average issued cost. */
export function ReturnModal({ order, onClose, onDone }: { order: ProductionOrder; onClose: () => void; onDone: () => void }) {
  const lines = order.materials.filter((m) => m.suppliedBy === "BUSINESS" && m.atProducer > 0);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const chosen = lines.map((m) => ({ m, n: whole(qty[m.id] || "0") })).filter((x) => x.n > 0);
  const tooMany = chosen.filter((x) => x.n > x.m.atProducer);
  const body = { lines: chosen.map((x) => ({ materialLineId: x.m.id, quantity: x.n })), note: note.trim() || null };
  const scope = `mo-return:${order.id}`;
  const ret = useMutation({
    mutationFn: () => mfg.returnMaterials(order.id, body, idempotencyKeyFor(scope, body)),
    onSuccess: () => { settleIdempotencyKey(scope); toast.success("Material returned to stock"); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The material couldn't be returned")),
  });
  return (
    <Modal open onClose={onClose} title={`Return unused material — ${order.number}`} description="Only what is still with the producer can come back." widthClassName="max-w-2xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={ret.isPending} disabled={!chosen.length || tooMany.length > 0} onClick={() => ret.mutate()} data-testid="confirm-return">Return</Button></>}>
      <div className="space-y-3">
        {lines.length === 0 && <p className="text-sm text-ink-600">Nothing is with the producer.</p>}
        {lines.map((m) => (
          <div key={m.id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-end gap-3 border-b border-line pb-2 last:border-0">
            <div className="min-w-0 text-sm"><span className="font-mono text-xs text-ink-600">{m.sku}</span><span className="block truncate">{m.name}</span><span className="text-xs text-ink-500">{m.atProducer.toLocaleString()} {m.stockUnit} with the producer</span></div>
            <Field htmlFor={`ret-${m.id}`} label={m.stockUnit}><Input id={`ret-${m.id}`} inputMode="numeric" value={qty[m.id] ?? ""} placeholder="0" onChange={(e) => setQty((q) => ({ ...q, [m.id]: e.target.value }))} /></Field>
          </div>
        ))}
        {tooMany.length > 0 && <Alert variant="danger" title="More than is with the producer">{tooMany.map((x) => x.m.sku).join(", ")}</Alert>}
        <Field htmlFor="ret-note" label="Note"><Input id="ret-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. offcuts back" /></Field>
      </div>
    </Modal>
  );
}

/** Record what the producer used and scrapped of the issued material (totals so far). Nothing posts — it stays in WIP. */
export function UsageModal({ order, onClose, onDone }: { order: ProductionOrder; onClose: () => void; onDone: () => void }) {
  const lines = order.materials.filter((m) => m.suppliedBy === "BUSINESS" && m.issuedQty > 0);
  const [values, setValues] = useState<Record<string, { used: string; scrap: string }>>(Object.fromEntries(lines.map((m) => [m.id, { used: String(m.consumedQty), scrap: String(m.scrappedQty) }])));
  const parsed = lines.map((m) => ({ m, used: whole(values[m.id]?.used ?? "0"), scrap: whole(values[m.id]?.scrap ?? "0") }));
  const bad = parsed.filter((x) => Number.isNaN(x.used) || Number.isNaN(x.scrap) || x.used + x.scrap > x.m.issuedQty - x.m.returnedQty);
  const save = useMutation({
    mutationFn: () => mfg.declareMaterialUsage(order.id, parsed.map((x) => ({ materialLineId: x.m.id, consumedQty: x.used, scrappedQty: x.scrap }))),
    onSuccess: () => { toast.success("Usage recorded"); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "Usage couldn't be recorded")),
  });
  return (
    <Modal open onClose={onClose} title={`Record material usage — ${order.number}`} description="Totals so far: what went into the products and what was scrapped. The rest is still with the producer." widthClassName="max-w-2xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!lines.length || bad.length > 0} onClick={() => save.mutate()} data-testid="confirm-usage">Save</Button></>}>
      <div className="space-y-3">
        {lines.map((m) => (
          <div key={m.id} className="grid grid-cols-[minmax(0,1fr)_6rem_6rem] items-end gap-3 border-b border-line pb-2 last:border-0">
            <div className="min-w-0 text-sm"><span className="font-mono text-xs text-ink-600">{m.sku}</span><span className="block truncate">{m.name}</span><span className="text-xs text-ink-500">{(m.issuedQty - m.returnedQty).toLocaleString()} {m.stockUnit} issued, net of returns</span></div>
            <Field htmlFor={`use-${m.id}`} label="Used"><Input id={`use-${m.id}`} inputMode="numeric" value={values[m.id]?.used ?? ""} onChange={(e) => setValues((v) => ({ ...v, [m.id]: { ...v[m.id]!, used: e.target.value } }))} /></Field>
            <Field htmlFor={`scr-${m.id}`} label="Scrapped"><Input id={`scr-${m.id}`} inputMode="numeric" value={values[m.id]?.scrap ?? ""} onChange={(e) => setValues((v) => ({ ...v, [m.id]: { ...v[m.id]!, scrap: e.target.value } }))} /></Field>
          </div>
        ))}
        {bad.length > 0 && <Alert variant="danger" title="More than was issued">{bad.map((x) => x.m.sku).join(", ")}: used + scrapped can&apos;t exceed what was issued, net of returns.</Alert>}
      </div>
    </Modal>
  );
}
