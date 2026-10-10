"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { ReasonModal } from "@/components/admin/purchasing/reason-modal";
import { COST_GROUP_LABEL } from "@/components/admin/manufacturing/status";
import { getErrorMessage } from "@/lib/api-client";
import * as mfg from "@/lib/api/manufacturing";
import type { CostEntry, ProductionOrder } from "@/lib/api/manufacturing";
import * as purchasingApi from "@/lib/api/purchasing";
import { formatPrice } from "@/lib/format";

const STATUS = { DRAFT: { variant: "neutral", label: "awaiting approval" }, APPROVED: { variant: "success", label: "approved" }, VOID: { variant: "neutral", label: "void" } } as const;
const QTY = /^\d{1,12}(\.\d{1,4})?$/;
const RATE = /^\d{1,12}(\.\d{1,6})?$/;

/** Actual production costs of an order (docs/MANUFACTURING.md §7) and how they compare with the plan. Entered by production
 * staff; approved — and so accrued into work in progress — by someone else. */
export function ProductionCosts({ order, can, adminId, onChanged }: { order: ProductionOrder; can: (c: "manufacturing.manage" | "manufacturing.approve" | "costing.view") => boolean; adminId: string | null; onChanged: () => void }) {
  const [editing, setEditing] = useState<CostEntry | "new" | null>(null);
  const [voiding, setVoiding] = useState<CostEntry | null>(null);
  // A closed order still takes late costs: approving (or voiding) one moves it straight on to the finished goods.
  const open = ["APPROVED", "IN_PRODUCTION", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"].includes(order.status);
  const closed = order.status === "CLOSED";
  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approve" | "delete" }): Promise<void> => { if (action === "approve") await mfg.approveCostEntry(id); else await mfg.deleteCostEntry(id); },
    onSuccess: (_r, v) => { onChanged(); toast.success(v.action === "approve" ? (closed ? "Late cost approved — added to the finished goods' cost" : "Cost approved — accrued to work in progress") : "Draft deleted"); },
    onError: (err) => toast.error(getErrorMessage(err, "That didn't work")),
  });
  const voidIt = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => mfg.voidCostEntry(id, reason),
    onSuccess: () => { onChanged(); setVoiding(null); toast.success("Cost voided"); },
    onError: (err) => toast.error(getErrorMessage(err, "The cost couldn't be voided")),
  });
  const cmp = order.comparison;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink-900">Production costs</h2>
        {can("manufacturing.manage") && open && <Button size="sm" variant="outline" onClick={() => setEditing("new")} data-testid="add-cost"><Plus className="h-4 w-4" /> {closed ? "Add late cost" : "Add cost"}</Button>}
      </div>
      {cmp && cmp.pendingApproval > 0 && <Alert variant="info" title={`${formatPrice(cmp.pendingApproval)} awaiting approval`}>Costs count once someone other than who entered them approves them.</Alert>}
      {order.costs.length ? (
        <Card className="divide-y divide-line p-0 text-sm" data-testid="cost-list">
          {order.costs.map((c) => (
            <div key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className={c.status === "VOID" ? "text-ink-500 line-through" : "text-ink-900"}>{c.description}</p>
                <p className="text-xs text-ink-500">
                  {c.category.name} · {c.costDate}{c.supplier ? ` · ${c.supplier.displayName}` : ""}{c.reference ? ` · ref ${c.reference}` : ""}
                  {c.quantity ? ` · ${Number(c.quantity).toLocaleString()} × ${Number(c.unitRate).toLocaleString(undefined, { maximumFractionDigits: 6 })}` : ""}
                  {c.voidReason ? ` · void: ${c.voidReason}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium tabular-nums">{formatPrice(c.amount)}</span>
                <Badge variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Badge>
                {c.status === "DRAFT" && can("manufacturing.manage") && <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>Edit</Button>}
                {c.status === "DRAFT" && can("manufacturing.approve") && c.createdByAdminId !== adminId && <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ id: c.id, action: "approve" })} data-testid="approve-cost">Approve</Button>}
                {c.status === "DRAFT" && can("manufacturing.manage") && <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: c.id, action: "delete" })}>Delete</Button>}
                {c.status !== "VOID" && can("manufacturing.approve") && open && <Button size="sm" variant="ghost" onClick={() => setVoiding(c)}>Void</Button>}
              </div>
            </div>
          ))}
        </Card>
      ) : (
        <p className="text-sm text-ink-600">No production costs yet — add contract, labour, freight and other costs as their bills arrive.</p>
      )}

      {cmp && (
        <Card className="overflow-hidden p-0">
          <HScrollShadow>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Planned vs actual</TableHeaderCell>
                  <TableHeaderCell align="right">Planned</TableHeaderCell>
                  <TableHeaderCell align="right">Actual</TableHeaderCell>
                  <TableHeaderCell align="right">Variance</TableHeaderCell>
                </tr>
              </TableHead>
              <tbody>
                <TableRow>
                  <TableCell>Materials (issued, less returns){cmp.materials.plannedIncomplete ? <span className="block text-xs text-ink-500">plan excludes materials with no known cost</span> : null}</TableCell>
                  <TableCell align="right" className="tabular-nums">{formatPrice(cmp.materials.planned)}</TableCell>
                  <TableCell align="right" className="tabular-nums">{formatPrice(cmp.materials.actual)}</TableCell>
                  <TableCell align="right" className={cmp.materials.variance > 0 ? "tabular-nums text-danger-700" : "tabular-nums"}>{formatPrice(cmp.materials.variance)}</TableCell>
                </TableRow>
                {cmp.categories.map((r) => (
                  <TableRow key={r.category.id}>
                    <TableCell>{r.category.name} <span className="text-xs text-ink-500">· {COST_GROUP_LABEL[r.category.group]}</span></TableCell>
                    <TableCell align="right" className="tabular-nums">{formatPrice(r.planned)}</TableCell>
                    <TableCell align="right" className="tabular-nums">{formatPrice(r.actual)}</TableCell>
                    <TableCell align="right" className={r.variance > 0 ? "tabular-nums text-danger-700" : "tabular-nums"}>{formatPrice(r.variance)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell align="right" className="font-semibold tabular-nums">{formatPrice(cmp.total.planned)}</TableCell>
                  <TableCell align="right" className="font-semibold tabular-nums" data-testid="actual-total">{formatPrice(cmp.total.actual)}</TableCell>
                  <TableCell align="right" className={cmp.total.variance > 0 ? "font-semibold tabular-nums text-danger-700" : "font-semibold tabular-nums"}>{formatPrice(cmp.total.variance)}</TableCell>
                </TableRow>
              </tbody>
            </Table>
          </HScrollShadow>
        </Card>
      )}

      {editing && <CostModal order={order} entry={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { onChanged(); setEditing(null); }} />}
      {voiding && <ReasonModal title="Void this cost" hint={voiding.status === "APPROVED" ? (closed ? "Its accrual is reversed and the finished goods' cost comes down by the same amount." : "Its accrual in work in progress is reversed.") : undefined} loading={voidIt.isPending} onClose={() => setVoiding(null)} onConfirm={(reason) => voidIt.mutate({ id: voiding.id, reason })} />}
    </section>
  );
}

function CostModal({ order, entry, onClose, onDone }: { order: ProductionOrder; entry: CostEntry | null; onClose: () => void; onDone: () => void }) {
  const [categoryId, setCategoryId] = useState(entry?.category.id ?? "");
  const [supplierId, setSupplierId] = useState(entry?.supplier?.id ?? order.producer?.id ?? "");
  const [reference, setReference] = useState(entry?.reference ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [mode, setMode] = useState<"rate" | "amount">(entry ? (entry.quantity ? "rate" : "amount") : "rate");
  const [quantity, setQuantity] = useState(entry?.quantity ?? String(order.plannedUnits));
  const [rate, setRate] = useState(entry?.unitRate ?? "");
  const [amount, setAmount] = useState(entry && !entry.quantity ? String(entry.amount) : "");
  const [costDate, setCostDate] = useState(entry?.costDate ?? "");
  const categories = useQuery({ queryKey: mfg.manufacturingKeys.categories(), queryFn: () => mfg.listCostCategories(true) });
  const suppliers = useQuery({ queryKey: purchasingApi.purchasingKeys.suppliers({}), queryFn: () => purchasingApi.listSuppliers({ pageSize: 200 }) });
  const preview = mode === "rate" && QTY.test(quantity) && RATE.test(rate) ? Number(quantity) * Number(rate) : mode === "amount" ? Number(amount) : NaN;
  const valid = categoryId && description.trim().length >= 2 && (mode === "rate" ? QTY.test(quantity) && RATE.test(rate) && Number(quantity) > 0 : Number(amount) > 0);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        categoryId, supplierId: supplierId || null, reference: reference.trim() || null, description: description.trim(), ...(costDate ? { costDate } : {}),
        ...(mode === "rate" ? { quantity, unitRate: rate, amount: null } : { amount: Number(amount), quantity: null, unitRate: null }),
      };
      return entry ? mfg.updateCostEntry(entry.id, body) : mfg.createCostEntry(order.id, body);
    },
    onSuccess: () => { toast.success("Cost saved — awaiting approval"); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The cost couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title={entry ? "Edit cost" : "Add production cost"} description="Saved for approval by someone else; once approved it counts in this order's cost." widthClassName="max-w-2xl"
      footer={<div className="flex w-full flex-wrap items-center justify-between gap-3"><span className="text-sm tabular-nums text-ink-700">{Number.isFinite(preview) && preview > 0 ? formatPrice(Math.round(preview * 100) / 100) : ""}</span><span className="flex gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="save-cost">Save</Button></span></div>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field htmlFor="cost-cat" label="Category" required>
            <Select id="cost-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Choose…</option>
              {categories.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field htmlFor="cost-sup" label="Paid to">
            <Select id="cost-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Internal / no supplier</option>
              {suppliers.data?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.displayName} ({s.code})</option>)}
            </Select>
          </Field>
        </div>
        <Field htmlFor="cost-desc" label="Description" required><Input id="cost-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="e.g. Stitching, first batch" /></Field>
        <div className="flex gap-2" role="radiogroup" aria-label="How the cost is given">
          <Button size="sm" variant={mode === "rate" ? "primary" : "outline"} onClick={() => setMode("rate")} aria-pressed={mode === "rate"}>Quantity × rate</Button>
          <Button size="sm" variant={mode === "amount" ? "primary" : "outline"} onClick={() => setMode("amount")} aria-pressed={mode === "amount"}>Amount</Button>
        </div>
        {mode === "rate" ? (
          <div className="grid grid-cols-2 gap-4">
            <Field htmlFor="cost-qty" label="Quantity"><Input id="cost-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
            <Field htmlFor="cost-rate" label="Rate"><Input id="cost-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="per piece" /></Field>
          </div>
        ) : (
          <Field htmlFor="cost-amt" label="Amount"><Input id="cost-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field htmlFor="cost-ref" label="Bill / challan reference" hint="Each reference is costed once per supplier and category."><Input id="cost-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} /></Field>
          <Field htmlFor="cost-date" label="Date"><Input id="cost-date" type="date" value={costDate} onChange={(e) => setCostDate(e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}
