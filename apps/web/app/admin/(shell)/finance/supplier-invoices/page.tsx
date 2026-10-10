"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { ReasonModal } from "@/components/admin/purchasing/reason-modal";
import { INVOICE_LINE_LABEL, INVOICE_STATUS_BADGE, INVOICE_STATUS_LABEL } from "@/components/admin/purchasing/status";
import { SupplierInvoiceModal } from "@/components/admin/payables/invoice-modal";
import { useCapabilities } from "@/hooks/use-capability";
import { ApiError, getErrorMessage } from "@/lib/api-client";
import * as purchasingApi from "@/lib/api/purchasing";
import type { SupplierInvoice, SupplierInvoiceKind } from "@/lib/api/purchasing";
import { formatPrice } from "@/lib/format";

const errorCode = (err: unknown) => (err instanceof ApiError ? (err.details as { code?: string } | undefined)?.code : undefined);

/** Supplier bills and credit notes (docs/FINANCE_PHASE_4E.md): what you owe each supplier. Posting a bill moves goods
 * received from "not yet invoiced" into payables; a price different from the order adjusts the goods' cost. */
export default function SupplierInvoicesPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("ap.view");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState<SupplierInvoiceKind | null>(null);
  const [voiding, setVoiding] = useState<SupplierInvoice | null>(null);
  const [variance, setVariance] = useState<{ invoice: SupplierInvoice; message: string } | null>(null);
  const query = { status: status || undefined, kind: kind || undefined, q: q.trim() || undefined, pageSize: 100 };
  const list = useQuery({ queryKey: purchasingApi.payablesKeys.invoices(query), queryFn: () => purchasingApi.listSupplierInvoices(query), enabled: allowed });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: purchasingApi.purchasingKeys.all });

  const post = useMutation({
    mutationFn: ({ invoice, reason }: { invoice: SupplierInvoice; reason?: string }) => purchasingApi.postSupplierInvoice(invoice.id, reason),
    onSuccess: (r) => { refresh(); setVariance(null); toast.success(`${r.invoice.number} posted`); },
    onError: (err, v) => {
      if (errorCode(err) === "INVOICE_PRICE_VARIANCE" && can("purchasing.approve") && !v.reason) setVariance({ invoice: v.invoice, message: getErrorMessage(err, "") });
      else toast.error(getErrorMessage(err, "The document couldn't be posted"));
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => purchasingApi.deleteSupplierInvoice(id),
    onSuccess: () => { refresh(); toast.success("Draft deleted"); },
    onError: (err) => toast.error(getErrorMessage(err, "The draft couldn't be deleted")),
  });
  const voidIt = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => purchasingApi.voidSupplierInvoice(id, reason),
    onSuccess: (i) => { refresh(); setVoiding(null); toast.success(`${i.number} voided`); },
    onError: (err) => toast.error(getErrorMessage(err, "The document couldn't be voided")),
  });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={FileText} title="Payables aren't available to your role" />
      </div>
    );
  }
  const filtered = Boolean(status || kind || q.trim());
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Supplier bills"
        description="Bills and credit notes from suppliers, matched to what you received, returned or ordered."
        action={can("ap.manage") && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setCreating("CREDIT_NOTE")} data-testid="new-credit-note">Credit note</Button>
            <Button size="sm" onClick={() => setCreating("INVOICE")} data-testid="new-bill"><Plus className="h-4 w-4" /> New bill</Button>
          </div>
        )}
      />
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search number, reference or supplier" wrapperClassName="w-full sm:w-72" />
        <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} className="w-full sm:w-40">
          <option value="">Bills and credits</option>
          <option value="INVOICE">Bills</option>
          <option value="CREDIT_NOTE">Credit notes</option>
        </Select>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-40">
          <option value="">Every status</option>
          <option value="DRAFT">Draft</option>
          <option value="POSTED">Posted</option>
          <option value="VOID">Void</option>
        </Select>
        <Link href="/admin/finance/payables" className="text-sm underline-offset-4 hover:underline">Payables by supplier</Link>
      </div>
      {list.isLoading && <Skeleton className="h-40 w-full" />}
      {list.isError && <Alert variant="danger" title="Supplier bills couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => list.refetch()}>Retry</Button>}>{getErrorMessage(list.error, "")}</Alert>}
      {list.data?.invoices.length === 0 && <EmptyState icon={FileText} title={filtered ? "Nothing matches" : "No supplier bills yet"} description={filtered ? "Try other filters." : "Enter a bill when a supplier invoices goods you received or a service you ordered."} />}
      <div className="space-y-3">
        {list.data?.invoices.map((i) => (
          <Card key={i.id} className="space-y-3 p-4" data-testid="invoice-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-sm text-ink-900">{i.number} <span className="font-sans text-ink-600">· {i.kind === "INVOICE" ? "bill" : "credit note"} {i.supplierRef}</span></p>
                <p className="text-sm text-ink-600">
                  {i.supplier.displayName} · {i.invoiceDate}
                  {i.kind === "INVOICE" && <> · due <span className={i.overdue ? "text-danger-700" : undefined}>{i.dueDate}{i.overdue ? " (overdue)" : ""}</span></>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-right text-sm font-medium tabular-nums">
                  {i.kind === "CREDIT_NOTE" ? "−" : ""}{formatPrice(i.total)}
                  {i.status === "POSTED" && i.outstanding !== null && i.settled > 0 && (
                    <span className="block text-xs font-normal text-ink-500">{i.outstanding === 0 ? (i.kind === "INVOICE" ? "paid in full" : "fully used") : `${formatPrice(i.outstanding)} ${i.kind === "INVOICE" ? "still owed" : "left"}`}</span>
                  )}
                </span>
                <Badge variant={INVOICE_STATUS_BADGE[i.status]}>{INVOICE_STATUS_LABEL[i.status]}</Badge>
              </div>
            </div>
            <ul className="space-y-1 text-sm">
              {i.lines.map((l) => (
                <li key={l.id} className="flex flex-wrap justify-between gap-2">
                  <span className="min-w-0">
                    <span className="text-xs text-ink-500">{INVOICE_LINE_LABEL[l.lineType]}</span>{" "}
                    {l.description}
                    {l.goodsReceipt && !l.description.includes(l.goodsReceipt.number) && <span className="text-ink-500"> · {l.goodsReceipt.number}</span>}
                    {l.purchaseReturn && !l.description.includes(l.purchaseReturn.number) && <span className="text-ink-500"> · {l.purchaseReturn.number}</span>}
                    {l.productionOrder && <> · <Link href={`/admin/manufacturing/production-orders/${l.productionOrder.id}`} className="underline-offset-4 hover:underline">open order</Link></>}
                  </span>
                  <span className="tabular-nums text-ink-700">
                    {l.quantity} × {formatPrice(l.unitPrice)}{l.tax ? ` + tax ${formatPrice(l.tax)}` : ""}
                    {l.priceDifference ? <span className={l.priceDifference > 0 ? "block text-xs text-warning-700" : "block text-xs text-ink-500"}>price difference {formatPrice(l.priceDifference)}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {(i.varianceReason || i.voidReason) && <p className="text-xs text-ink-500">{[i.varianceReason && `Price variance approved: ${i.varianceReason}`, i.voidReason && `Voided: ${i.voidReason}`].filter(Boolean).join(" · ")}</p>}
            {can("ap.manage") && i.status !== "VOID" && (
              <div className="flex flex-wrap gap-2">
                {i.status === "DRAFT" && <Button size="sm" loading={post.isPending} onClick={() => post.mutate({ invoice: i })} data-testid="invoice-card-post">Post</Button>}
                {i.status === "DRAFT" && <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate(i.id)}>Delete draft</Button>}
                {i.status === "POSTED" && <Button size="sm" variant="outline" onClick={() => setVoiding(i)}>Void</Button>}
              </div>
            )}
          </Card>
        ))}
      </div>
      {creating && (
        <SupplierInvoiceModal
          kind={creating}
          onClose={() => setCreating(null)}
          onDone={(invoice, posted) => { refresh(); setCreating(null); toast.success(`${invoice.number} ${posted ? "posted" : "saved as a draft"}`); }}
        />
      )}
      {voiding && <ReasonModal title={`Void ${voiding.number}`} hint="Its journal is reversed; a price difference it put on the goods comes off again. The goods or costs it billed can then be billed again." loading={voidIt.isPending} onClose={() => setVoiding(null)} onConfirm={(reason) => voidIt.mutate({ id: voiding.id, reason })} />}
      {variance && <ReasonModal title={`Approve the price on ${variance.invoice.number}`} hint={variance.message} loading={post.isPending} onClose={() => setVariance(null)} onConfirm={(reason) => post.mutate({ invoice: variance.invoice, reason })} />}
    </div>
  );
}
