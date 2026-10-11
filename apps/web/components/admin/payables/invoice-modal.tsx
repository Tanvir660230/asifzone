"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import * as purchasingApi from "@/lib/api/purchasing";
import type { SupplierInvoice, SupplierInvoiceKind, SupplierInvoiceLineType, TaxCode } from "@/lib/api/purchasing";
import { formatPrice } from "@/lib/format";

/** One candidate line: something the supplier can bill (from its open items) or a free expense line. */
interface Row {
  key: string;
  type: SupplierInvoiceLineType;
  include: boolean;
  label: string;
  hint: string;
  refId: string | null;
  purchaseOrderLineId: string | null;
  maxQty: number | null;
  qty: string;
  price: string;
  /** Production costs bill exactly their approved amount. */
  fixedPrice: boolean;
  taxCodeId: string;
  accountId: string;
  description: string;
}
let seq = 0;

/** Entering a supplier's bill or credit note (docs/FINANCE_PHASE_4E.md): pick what it bills from the supplier's open items
 * (goods received, services ordered, production costs — or, for a credit note, goods returned), adjust quantities and
 * prices to the document, add other expense lines, then save a draft or post it. */
export function SupplierInvoiceModal({ kind, onClose, onDone }: { kind: SupplierInvoiceKind; onClose: () => void; onDone: (invoice: SupplierInvoice, posted: boolean) => void }) {
  const credit = kind === "CREDIT_NOTE";
  const [supplierId, setSupplierId] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loadedFor, setLoadedFor] = useState("");
  const suppliers = useQuery({ queryKey: purchasingApi.purchasingKeys.suppliers({ pageSize: 200 }), queryFn: () => purchasingApi.listSuppliers({ pageSize: 200 }) });
  const taxCodes = useQuery({ queryKey: ["purchasing", "tax-codes", "active"], queryFn: () => purchasingApi.listTaxCodes(true) });
  const accounts = useQuery({ queryKey: ["finance", "accounts"], queryFn: financeApi.listLedgerAccounts });
  const expenseAccounts = useMemo(() => (accounts.data?.accounts ?? []).filter((a) => a.isPostable && a.isActive && (a.type === "EXPENSE" || a.type === "ASSET")), [accounts.data]);
  const open = useQuery({ queryKey: purchasingApi.payablesKeys.openItems(supplierId), queryFn: () => purchasingApi.supplierOpenItems(supplierId), enabled: Boolean(supplierId) });

  // Seed the rows once per supplier from its open items.
  if (open.data && loadedFor !== supplierId) {
    const o = open.data;
    const tax = o.supplier.defaultTaxCodeId ?? "";
    const next: Row[] = credit
      ? o.returns.map((r) => ({ key: `r${++seq}`, type: "RETURN", include: false, label: `${r.sku}`, hint: `${r.purchaseReturn.number} · ${r.open} returned, not credited`, refId: r.purchaseReturnLineId, purchaseOrderLineId: null, maxQty: r.open, qty: String(r.open), price: r.returnedUnitValue === null ? "" : String(r.returnedUnitValue), fixedPrice: false, taxCodeId: tax, accountId: "", description: "" }))
      : [
          ...o.goods.map((g) => ({ key: `g${++seq}`, type: "STOCK" as const, include: false, label: `${g.sku} — ${g.name}`, hint: `${g.goodsReceipt.number} · ${g.open} received, not invoiced${g.orderedUnitPrice !== null ? ` · ordered at ${formatPrice(g.orderedUnitPrice)}` : ""}`, refId: g.goodsReceiptLineId, purchaseOrderLineId: null, maxQty: g.open, qty: String(g.open), price: String(g.orderedUnitPrice ?? g.receiptUnitCost), fixedPrice: false, taxCodeId: g.taxCodeId ?? tax, accountId: "", description: "" })),
          ...o.services.map((s) => ({ key: `s${++seq}`, type: "EXPENSE" as const, include: false, label: s.description, hint: `${s.purchaseOrder.number} · ${s.open} ordered, not invoiced`, refId: null, purchaseOrderLineId: s.purchaseOrderLineId, maxQty: s.open, qty: String(s.open), price: String(s.unitPrice), fixedPrice: false, taxCodeId: s.taxCodeId ?? tax, accountId: s.expenseAccountId ?? "", description: s.description })),
          ...o.productionCosts.map((c) => ({ key: `c${++seq}`, type: "PRODUCTION_COST" as const, include: false, label: `${c.category} — ${c.description}`, hint: `${c.productionOrder.number}${c.reference ? ` · ref ${c.reference}` : ""} · approved`, refId: c.productionCostEntryId, purchaseOrderLineId: null, maxQty: 1, qty: "1", price: String(c.amount), fixedPrice: true, taxCodeId: tax, accountId: "", description: "" })),
        ];
    setRows(next);
    setLoadedFor(supplierId);
  }

  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addExpense = () => setRows((rs) => [...rs, { key: `e${++seq}`, type: "EXPENSE", include: true, label: "", hint: "", refId: null, purchaseOrderLineId: null, maxQty: null, qty: "1", price: "", fixedPrice: false, taxCodeId: open.data?.supplier.defaultTaxCodeId ?? "", accountId: "", description: "" }]);
  const chosen = rows.filter((r) => r.include);
  const rowError = (r: Row): string | null => {
    const q = Number(r.qty);
    if (!Number.isInteger(q) || q < 1) return "Quantity is a whole number, 1 or more";
    if (r.maxQty !== null && q > r.maxQty) return `At most ${r.maxQty}`;
    if (r.price.trim() === "" || !(Number(r.price) >= 0)) return "Enter the unit price";
    if (r.type === "EXPENSE" && !r.accountId) return "Choose the expense account";
    if (r.type === "EXPENSE" && !r.refId && !r.purchaseOrderLineId && r.description.trim().length < 2) return "Describe the expense";
    return null;
  };
  const net = chosen.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.price) || 0), 0);
  const valid = Boolean(supplierId) && supplierRef.trim().length > 0 && chosen.length > 0 && chosen.every((r) => !rowError(r));

  const save = useMutation({
    mutationFn: async (post: boolean) => {
      const invoice = await purchasingApi.createSupplierInvoice({
        kind, supplierId, supplierRef: supplierRef.trim(), invoiceDate: invoiceDate || undefined, dueDate: dueDate || null, notes: notes.trim() || null,
        lines: chosen.map((r) => ({
          lineType: r.type,
          goodsReceiptLineId: r.type === "STOCK" ? r.refId : null,
          purchaseReturnLineId: r.type === "RETURN" ? r.refId : null,
          productionCostEntryId: r.type === "PRODUCTION_COST" ? r.refId : null,
          purchaseOrderLineId: r.purchaseOrderLineId,
          expenseAccountId: r.type === "EXPENSE" ? r.accountId : null,
          description: r.type === "EXPENSE" ? r.description.trim() || r.label : null,
          quantity: Number(r.qty),
          unitPrice: Number(r.price),
          taxCodeId: r.taxCodeId || null,
        })),
      });
      if (!post) return { invoice, posted: false };
      try {
        return { invoice: (await purchasingApi.postSupplierInvoice(invoice.id)).invoice, posted: true };
      } catch (err) {
        // The draft is saved; the list offers posting it again (e.g. with a price-variance reason).
        toast.error(getErrorMessage(err, "Saved as a draft — it couldn't be posted"));
        return { invoice, posted: false };
      }
    },
    onSuccess: ({ invoice, posted }) => onDone(invoice, posted),
    onError: (err) => toast.error(getErrorMessage(err, "The document couldn't be saved")),
  });

  const title = credit ? "New credit note" : "New supplier bill";
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={credit ? "A supplier's credit for goods you returned or an overcharge." : "Match the supplier's bill to what you received or ordered — the goods' cost follows the bill's price."}
      widthClassName="max-w-3xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="outline" loading={save.isPending} disabled={!valid} onClick={() => save.mutate(false)} data-testid="invoice-save-draft">Save draft</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate(true)} data-testid="invoice-post">Post</Button></>}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor="inv-supplier" label="Supplier" required>
            <Select id="inv-supplier" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setRows([]); setLoadedFor(""); }} data-testid="invoice-supplier">
              <option value="">Choose…</option>
              {suppliers.data?.suppliers.filter((s) => s.status !== "INACTIVE").map((s) => <option key={s.id} value={s.id}>{s.displayName} ({s.code})</option>)}
            </Select>
          </Field>
          <Field htmlFor="inv-ref" label={credit ? "Supplier's credit-note number" : "Supplier's invoice number"} required>
            <Input id="inv-ref" value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} maxLength={100} data-testid="invoice-ref" />
          </Field>
          <Field htmlFor="inv-date" label="Document date" hint="Today if left empty.">
            <Input id="inv-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </Field>
          {!credit && (
            <Field htmlFor="inv-due" label="Due date" hint={open.data ? `Empty = ${open.data.supplier.paymentTermsDays} days after the invoice date (the supplier's terms).` : "Empty = the supplier's payment terms."}>
              <Input id="inv-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          )}
        </div>

        {supplierId && open.isLoading && <Skeleton className="h-24 w-full" />}
        {open.isError && <Alert variant="danger" title="The supplier's open items couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => open.refetch()}>Retry</Button>}>{getErrorMessage(open.error, "")}</Alert>}
        {open.data && rows.filter((r) => r.hint).length === 0 && (
          <p className="text-sm text-ink-600">{credit ? "Nothing returned to this supplier waits for a credit." : "Nothing received, ordered or produced by this supplier waits for a bill."} You can still add expense lines.</p>
        )}

        {rows.length > 0 && (
          <ul className="space-y-2">
            {rows.map((r) => {
              const err = r.include ? rowError(r) : null;
              return (
                <li key={r.key} className="space-y-2 rounded-xl border border-line p-3" data-testid="invoice-row">
                  <div className="flex items-start justify-between gap-3">
                    {r.hint ? (
                      <label className="flex min-w-0 items-start gap-2 text-sm">
                        <Checkbox checked={r.include} onChange={(e) => set(r.key, { include: e.target.checked })} aria-label={`Bill ${r.label}`} />
                        <span className="min-w-0"><span className="block text-ink-900">{r.label}</span><span className="block text-xs text-ink-500">{r.hint}</span></span>
                      </label>
                    ) : (
                      <span className="text-sm font-medium text-ink-900">Expense line</span>
                    )}
                    {!r.hint && <IconButton aria-label="Remove expense line" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}><Trash2 className="h-4 w-4" /></IconButton>}
                  </div>
                  {r.include && (
                    <div className="grid gap-2 sm:grid-cols-4">
                      {r.type === "EXPENSE" && !r.hint && (
                        <Field htmlFor={`d-${r.key}`} label="Description" className="sm:col-span-4"><Input id={`d-${r.key}`} value={r.description} onChange={(e) => set(r.key, { description: e.target.value })} maxLength={300} /></Field>
                      )}
                      {r.type === "EXPENSE" && (
                        <Field htmlFor={`a-${r.key}`} label="Expense account" className="sm:col-span-4">
                          <Select id={`a-${r.key}`} value={r.accountId} onChange={(e) => set(r.key, { accountId: e.target.value })}>
                            <option value="">Choose…</option>
                            {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                          </Select>
                        </Field>
                      )}
                      <Field htmlFor={`q-${r.key}`} label="Quantity"><Input id={`q-${r.key}`} inputMode="numeric" value={r.qty} disabled={r.type === "PRODUCTION_COST"} onChange={(e) => set(r.key, { qty: e.target.value })} /></Field>
                      <Field htmlFor={`p-${r.key}`} label="Unit price (net)" hint={r.fixedPrice ? "The approved amount" : undefined}><Input id={`p-${r.key}`} inputMode="decimal" value={r.price} disabled={r.fixedPrice} onChange={(e) => set(r.key, { price: e.target.value })} /></Field>
                      <Field htmlFor={`t-${r.key}`} label="Tax" className="sm:col-span-2">
                        <Select id={`t-${r.key}`} value={r.taxCodeId} onChange={(e) => set(r.key, { taxCodeId: e.target.value })}>
                          <option value="">No tax</option>
                          {(taxCodes.data?.taxCodes ?? []).map((t: TaxCode) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
                        </Select>
                      </Field>
                      {err && <p className="text-xs text-danger-700 sm:col-span-4">{err}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {supplierId && open.data && <Button size="sm" variant="outline" onClick={addExpense}><Plus className="h-4 w-4" /> Expense line</Button>}
        <Field htmlFor="inv-notes" label="Notes"><Textarea id="inv-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {chosen.length > 0 && <p className="text-sm text-ink-700">Net {formatPrice(Math.round(net * 100) / 100)} — tax is added per line when saved.</p>}
      </div>
    </Modal>
  );
}
