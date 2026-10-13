"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Table, TableCell, TableHead, TableHeaderCell, TableMessageRow, TableRow, TableSkeleton } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { VariantPicker } from "@/components/admin/purchasing/variant-picker";
import { PO_STATUS_BADGE, PO_STATUS_LABEL } from "@/components/admin/purchasing/status";
import { useCapabilities } from "@/hooks/use-capability";
import { useCreateParam } from "@/hooks/use-create-param";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import * as purchasingApi from "@/lib/api/purchasing";
import type { PurchasableVariant, PurchaseOrderStatus } from "@/lib/api/purchasing";
import { formatPrice } from "@/lib/format";


/** Purchase orders (docs/FINANCE_PHASE_4D.md): what was ordered from whom, at what price, and how much has arrived. An order
 * posts nothing — stock and its value arrive with goods receipts. */
export default function PurchaseOrdersPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("purchasing.view");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  useCreateParam("purchase-order", () => setCreating(true));
  const query = { status: status || undefined, q: q.trim() || undefined, pageSize: 100 };
  const list = useQuery({ queryKey: purchasingApi.purchasingDocKeys.orders(query), queryFn: () => purchasingApi.listPurchaseOrders(query), enabled: allowed });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={ClipboardList} title="Purchasing isn't available to your role" />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Purchase orders"
        description="Orders to suppliers: what, how many and at what price. Goods arrive against an order on a goods receipt, which brings the stock and its cost in."
        action={can("purchasing.manage") && <Button size="sm" onClick={() => setCreating(true)} data-testid="new-po"><Plus className="h-4 w-4" /> New order</Button>}
      />
      <div className="flex flex-wrap gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search number, supplier or SKU" wrapperClassName="w-full sm:w-72" />
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-52">
          <option value="">Every status</option>
          {(Object.keys(PO_STATUS_LABEL) as PurchaseOrderStatus[]).map((s) => <option key={s} value={s}>{PO_STATUS_LABEL[s]}</option>)}
        </Select>
      </div>
      <Card className="overflow-hidden p-0">
        <HScrollShadow>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Order</TableHeaderCell>
                <TableHeaderCell>Supplier</TableHeaderCell>
                <TableHeaderCell>Ordered</TableHeaderCell>
                <TableHeaderCell>Expected</TableHeaderCell>
                <TableHeaderCell align="right">Received</TableHeaderCell>
                <TableHeaderCell align="right">Total</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {list.isLoading && <TableSkeleton rows={5} cols={7} />}
              {list.isError && <TableMessageRow colSpan={7}>Orders couldn&apos;t be loaded. <Button size="sm" variant="ghost" onClick={() => list.refetch()}>Retry</Button></TableMessageRow>}
              {list.data?.purchaseOrders.map((po) => {
                const stock = po.lines.filter((l) => l.lineType === "STOCK");
                const ordered = stock.reduce((n, l) => n + l.qtyOrdered, 0);
                const received = stock.reduce((n, l) => n + l.qtyReceived, 0);
                return (
                  <TableRow key={po.id} interactive data-testid="po-row">
                    <TableCell className="whitespace-nowrap font-mono text-xs"><Link href={`/admin/finance/purchase-orders/${po.id}`} className="underline-offset-4 hover:underline">{po.number}</Link></TableCell>
                    <TableCell>{po.supplier.displayName}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{po.orderDate}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{po.expectedDate ?? "—"}</TableCell>
                    <TableCell align="right" className="tabular-nums">{ordered ? `${received} / ${ordered}` : "—"}</TableCell>
                    <TableCell align="right" className="tabular-nums">{formatPrice(po.total)}</TableCell>
                    <TableCell><Badge variant={PO_STATUS_BADGE[po.status]}>{PO_STATUS_LABEL[po.status]}</Badge></TableCell>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
        </HScrollShadow>
        {list.data?.purchaseOrders.length === 0 && <EmptyState icon={ClipboardList} title="No purchase orders" description={status || q ? "Nothing matches these filters." : "Create an order when you buy stock from a supplier."} />}
      </Card>
      {creating && <PurchaseOrderModal onClose={() => setCreating(false)} />}
    </div>
  );
}

interface DraftLine { key: number; lineType: "STOCK" | "NON_STOCK"; variant: PurchasableVariant | null; expenseAccountId: string; description: string; qty: string; price: string; taxCodeId: string }
let lineKey = 0;
const blankLine = (lineType: DraftLine["lineType"] = "STOCK"): DraftLine => ({ key: ++lineKey, lineType, variant: null, expenseAccountId: "", description: "", qty: "1", price: "", taxCodeId: "" });

function PurchaseOrderModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [deliveryTerms, setDeliveryTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const suppliers = useQuery({ queryKey: purchasingApi.purchasingKeys.suppliers({ status: "ACTIVE" }), queryFn: () => purchasingApi.listSuppliers({ status: "ACTIVE", pageSize: 200 }) });
  const taxCodes = useQuery({ queryKey: purchasingApi.purchasingKeys.taxCodes(), queryFn: () => purchasingApi.listTaxCodes(true) });
  const accounts = useQuery({ queryKey: financeApi.financeKeys.ledgerAccounts(), queryFn: financeApi.listLedgerAccounts, retry: false });
  const expenseAccounts = (accounts.data?.accounts ?? []).filter((a) => (a.type === "EXPENSE" || a.type === "COGS") && a.isPostable && a.isActive);
  const set = (key: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const valid = supplierId && lines.length > 0 && lines.every((l) => Number(l.qty) >= 1 && Number.isInteger(Number(l.qty)) && l.price.trim() !== "" && Number(l.price) >= 0 && (l.lineType === "STOCK" ? Boolean(l.variant) : Boolean(l.expenseAccountId && l.description.trim())));
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);

  const create = useMutation({
    mutationFn: () =>
      purchasingApi.createPurchaseOrder({
        supplierId,
        expectedDate: expectedDate || null,
        deliveryTerms: deliveryTerms.trim() || null,
        notes: notes.trim() || null,
        lines: lines.map((l) => ({
          lineType: l.lineType,
          variantId: l.lineType === "STOCK" ? l.variant!.id : null,
          expenseAccountId: l.lineType === "NON_STOCK" ? l.expenseAccountId : null,
          description: l.description.trim() || null,
          qtyOrdered: Number(l.qty),
          unitPrice: Number(l.price),
          taxCodeId: l.taxCodeId || null,
        })),
      }),
    onSuccess: (po) => {
      void queryClient.invalidateQueries({ queryKey: purchasingApi.purchasingKeys.all });
      toast.success(`${po.number} saved as a draft`);
      router.push(`/admin/finance/purchase-orders/${po.id}`);
    },
    onError: (err) => toast.error(getErrorMessage(err, "The order couldn't be saved")),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="New purchase order"
      description="Saved as a draft. Submit it for approval when it's complete."
      widthClassName="max-w-4xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <span className="text-sm tabular-nums text-ink-700">Total before tax {formatPrice(total)}</span>
          <span className="flex gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={create.isPending} disabled={!valid} onClick={() => create.mutate()} data-testid="save-po">Save draft</Button></span>
        </div>
      }
    >
      <div className="space-y-5">
        {suppliers.data?.suppliers.length === 0 && <Alert variant="warning" title="No active supplier">Add a supplier in Finance → Purchasing → Suppliers first.</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field htmlFor="po-supplier" label="Supplier" required>
            <Select id="po-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Choose…</option>
              {suppliers.data?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.displayName} ({s.code})</option>)}
            </Select>
          </Field>
          <Field htmlFor="po-expected" label="Expected delivery">
            <Input id="po-expected" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </Field>
          <Field htmlFor="po-terms" label="Delivery terms">
            <Input id="po-terms" value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} maxLength={300} />
          </Field>
        </div>
        <div className="space-y-3">
          {lines.map((l, i) => (
            <Card key={l.key} className="space-y-3 p-4" data-testid="po-line">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink-900">Line {i + 1}</p>
                <span className="flex items-center gap-2">
                  <Select aria-label={`Line ${i + 1} type`} value={l.lineType} onChange={(e) => set(l.key, { lineType: e.target.value as DraftLine["lineType"] })} className="w-44">
                    <option value="STOCK">Stock item</option>
                    <option value="NON_STOCK">Service / expense</option>
                  </Select>
                  {lines.length > 1 && <IconButton aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="h-4 w-4" /></IconButton>}
                </span>
              </div>
              {l.lineType === "STOCK" ? (
                <VariantPicker value={l.variant} onChange={(variant) => set(l.key, { variant })} label={`Line ${i + 1} variant`} />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input aria-label={`Line ${i + 1} description`} placeholder="What is it? (e.g. embroidery setup)" value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} maxLength={300} />
                  <Select aria-label={`Line ${i + 1} expense account`} value={l.expenseAccountId} onChange={(e) => set(l.key, { expenseAccountId: e.target.value })}>
                    <option value="">{accounts.isError ? "Accounts need finance access" : "Expense account…"}</option>
                    {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field htmlFor={`qty-${l.key}`} label="Quantity"><Input id={`qty-${l.key}`} inputMode="numeric" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} /></Field>
                <Field htmlFor={`price-${l.key}`} label="Unit price (net)"><Input id={`price-${l.key}`} inputMode="decimal" value={l.price} onChange={(e) => set(l.key, { price: e.target.value })} /></Field>
                <Field htmlFor={`tax-${l.key}`} label="Tax">
                  <Select id={`tax-${l.key}`} value={l.taxCodeId} onChange={(e) => set(l.key, { taxCodeId: e.target.value })}>
                    <option value="">None</option>
                    {taxCodes.data?.taxCodes.map((t) => <option key={t.id} value={t.id}>{t.code} ({t.rate}%)</option>)}
                  </Select>
                </Field>
                <div className="self-end pb-2 text-right text-sm tabular-nums text-ink-700">{formatPrice((Number(l.qty) || 0) * (Number(l.price) || 0))}</div>
              </div>
            </Card>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine("STOCK")])}><Plus className="h-4 w-4" /> Stock item</Button>
            <Button size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine("NON_STOCK")])}><Plus className="h-4 w-4" /> Service / expense</Button>
          </div>
        </div>
        <Field htmlFor="po-notes" label="Notes"><Textarea id="po-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
      </div>
    </Modal>
  );
}
