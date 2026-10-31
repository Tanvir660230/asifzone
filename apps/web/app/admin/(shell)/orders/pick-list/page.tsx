"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, ClipboardList, Printer, Tag } from "lucide-react";
import { PICK_SKIP_LABEL, type PackingSheet, type PickListResponse, type PrintKind } from "@clothing-brand/shared";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { BarcodeSvg } from "@/components/orders/barcode-svg";
import * as warehouseApi from "@/lib/api/warehouse";
import { getErrorMessage } from "@/lib/api-client";
import { ordersListHref } from "@/lib/admin/orders-return";
import { formatCount, formatPriceWhole, formatStoreDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type PrintTarget = "pick" | "sheets" | "both";

/**
 * Pick list and packing sheets (docs/WAREHOUSE_OPERATIONS.md §3). The selected orders' units grouped by product, size and
 * colour so each product is collected once, in shelf order; then one sheet per order to pack and check against. Printing
 * is recorded (first print or reprint, by whom) and changes nothing else — no stock, status, handover or money.
 */
export default function PickListPage() {
  const router = useRouter();
  const [ids, setIds] = useState<string[] | null>(null);
  const [backHref, setBackHref] = useState("/admin/orders");
  const [target, setTarget] = useState<PrintTarget>("both");
  const [printing, setPrinting] = useState(false);
  // On-screen packing check: ticked units per order line. A working aid while packing — not stored.
  const [packed, setPacked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setBackHref(ordersListHref());
    try {
      const raw = sessionStorage.getItem(warehouseApi.PICK_LIST_ORDER_IDS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      setIds(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
    } catch {
      setIds([]);
    }
  }, []);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["warehouse", "pick-list", ids],
    queryFn: () => warehouseApi.getPickList(ids!),
    enabled: Boolean(ids?.length),
  });

  async function print(kind: PrintTarget) {
    if (!data) return;
    setTarget(kind);
    setPrinting(true);
    const orderIds = data.sheets.map((s) => s.orderId);
    const kinds: PrintKind[] = kind === "pick" ? ["PICK_LIST"] : kind === "sheets" ? ["PACKING_SHEET"] : ["PICK_LIST", "PACKING_SHEET"];
    try {
      // One after the other: the two records touch the same orders.
      for (const k of kinds) await warehouseApi.recordPrintRun({ kind: k, clientRunId: warehouseApi.newPrintRunId(), orderIds });
    } catch (err) {
      // The paper still matters more than the log: print anyway, and say the print wasn't recorded.
      toast.error(getErrorMessage(err, "Printing, but this print wasn't recorded in the print log"));
    }
    // Let React apply the print target before the dialog opens.
    requestAnimationFrame(() => {
      window.print();
      setPrinting(false);
      void refetch();
    });
  }

  function productLabels() {
    if (!data) return;
    sessionStorage.setItem(warehouseApi.PRODUCT_LABEL_SELECTION_KEY, JSON.stringify(data.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity }))));
    router.push("/admin/orders/product-labels");
  }

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <Link href={backHref} className="mb-3 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
          <ArrowLeft size={14} /> Orders
        </Link>
        <PageHeader
          title="Pick list"
          description="Collect each product once, in shelf order, then pack each order against its sheet."
          action={
            data && data.sheets.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={productLabels}>
                  <Tag size={14} /> Product labels
                </Button>
                <Button variant="outline" size="sm" loading={printing && target === "pick"} onClick={() => print("pick")}>
                  <ClipboardList size={14} /> Print pick list
                </Button>
                <Button variant="outline" size="sm" loading={printing && target === "sheets"} onClick={() => print("sheets")}>
                  <Printer size={14} /> Print packing sheets
                </Button>
                <Button size="sm" loading={printing && target === "both"} onClick={() => print("both")}>
                  <Printer size={14} /> Print both
                </Button>
              </div>
            ) : null
          }
        />
      </div>

      {ids !== null && ids.length === 0 && (
        <EmptyState
          variant="bordered"
          icon={ClipboardList}
          title="No orders selected"
          description="Select orders on the Orders list (Ready to book is a good start), then choose Pick list."
          action={
            <Link href="/admin/orders?queue=readyToBook" className={buttonVariants({ size: "sm" })}>
              Open Ready to book
            </Link>
          }
        />
      )}
      {isError && <ErrorState description={getErrorMessage(error, "The pick list didn't load.")} onRetry={() => void refetch()} />}
      {(ids === null || isLoading) && ids?.length !== 0 && <PickListSkeleton />}

      {data && (
        <>
          {data.skipped.length > 0 && (
            <Alert variant="warning" title={`${data.skipped.length} selected ${data.skipped.length === 1 ? "order was" : "orders were"} left out`} className="print:hidden">
              <ul className="mt-1 space-y-0.5 text-sm">
                {data.skipped.map((s) => (
                  <li key={s.orderId}>
                    <span className="font-medium tabular-nums">{s.orderNumber ?? "Unknown order"}</span> — {PICK_SKIP_LABEL[s.reason]}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          {data.sheets.length === 0 ? (
            <EmptyState variant="bordered" icon={ClipboardList} title="Nothing to pick" description="None of the selected orders is waiting to be picked." />
          ) : (
            <>
              <PickListSection data={data} className={cn(target === "sheets" && "print:hidden")} />
              <PackingSheets data={data} packed={packed} onToggle={(key) => setPacked((p) => ({ ...p, [key]: !p[key] }))} className={cn(target === "pick" && "print:hidden")} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function PickListSkeleton() {
  return (
    <Card className="space-y-3 p-5">
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </Card>
  );
}

function PickListSection({ data, className }: { data: PickListResponse; className?: string }) {
  return (
    <section aria-labelledby="pick-title" className={cn("break-after-page", className)}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pick-title" className="font-display text-lg tracking-tight text-fg">
          Pick {formatCount(data.totals.units)} units · {formatCount(data.totals.products)} products · {formatCount(data.totals.orders)} orders
        </h2>
        <p className="text-xs text-fg-subtle">Made {formatStoreDateTime(data.generatedAt)}</p>
      </div>
      <Card className="overflow-hidden p-0 print:border-0 print:shadow-none">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-fg-subtle print:bg-transparent">
            <tr>
              <th scope="col" className="w-10 px-3 py-2">
                <span className="sr-only">Picked</span>
              </th>
              <th scope="col" className="px-3 py-2">Product</th>
              <th scope="col" className="hidden px-3 py-2 sm:table-cell print:table-cell">SKU</th>
              <th scope="col" className="px-3 py-2 text-right">Qty</th>
              <th scope="col" className="hidden px-3 py-2 md:table-cell print:table-cell">For orders</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {data.lines.map((l) => (
              <tr key={l.variantId} className="align-top">
                <td className="px-3 py-3">
                  <span className="block h-5 w-5 rounded border border-line" aria-hidden="true" />
                </td>
                <td className="px-3 py-3">
                  <span className="block font-medium text-fg">{l.productName}</span>
                  <span className="block text-fg-muted">{[l.size, l.color].filter(Boolean).join(" · ")}</span>
                  <span className="block text-xs text-fg-subtle sm:hidden print:hidden">{l.sku}</span>
                </td>
                <td className="hidden px-3 py-3 font-mono text-xs text-fg-muted sm:table-cell print:table-cell">{l.sku}</td>
                <td className="px-3 py-3 text-right font-display text-xl tabular-nums text-fg">{formatCount(l.quantity)}</td>
                <td className="hidden px-3 py-3 text-xs text-fg-muted md:table-cell print:table-cell">
                  {l.orders.map((o) => (
                    <span key={o.orderId} className="mr-2 inline-block tabular-nums">
                      {o.orderNumber}
                      {o.quantity > 1 && <span className="text-fg"> ×{o.quantity}</span>}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  );
}

function PackingSheets({
  data,
  packed,
  onToggle,
  className,
}: {
  data: PickListResponse;
  packed: Record<string, boolean>;
  onToggle: (key: string) => void;
  className?: string;
}) {
  return (
    <section aria-labelledby="sheets-title" className={cn("space-y-4", className)}>
      <h2 id="sheets-title" className="font-display text-lg tracking-tight text-fg print:hidden">
        Packing sheets
      </h2>
      {data.sheets.map((s) => (
        <PackingSheetCard key={s.orderId} sheet={s} packed={packed} onToggle={onToggle} />
      ))}
    </section>
  );
}

function PackingSheetCard({ sheet: s, packed, onToggle }: { sheet: PackingSheet; packed: Record<string, boolean>; onToggle: (key: string) => void }) {
  const done = s.items.every((i) => packed[i.orderItemId]);
  const printedSheets = s.printed.counts.PACKING_SHEET ?? 0;
  const labels = s.printed.counts.COURIER_LABEL ?? 0;
  return (
    <Card className="break-inside-avoid p-5 print:break-after-page print:border-0 print:p-0 print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-display text-xl tabular-nums tracking-tight text-fg">{s.orderNumber}</p>
          <p className="mt-1 text-sm font-medium text-fg">
            {s.customerName} · <span className="tabular-nums">{s.customerPhone}</span>
          </p>
          <p className="text-sm text-fg-muted">{[s.address, s.district].filter(Boolean).join(", ")}</p>
        </div>
        <div className="text-right">
          <div className="w-44">
            <BarcodeSvg value={s.trackingNumber || s.orderNumber} height={36} fontSize={10} />
          </div>
          <p className="mt-1 text-sm text-fg">
            {s.codAmount > 0 ? (
              <>
                Collect <span className="font-medium tabular-nums">{formatPriceWhole(s.codAmount)}</span>
              </>
            ) : (
              "Nothing to collect"
            )}
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-subtle print:hidden">
        <span>{s.courierConsignmentId ? `Booked · ${s.courierConsignmentId}` : "Not booked yet"}</span>
        <span>{labels > 0 ? `Courier label printed ${labels}×` : "Courier label not printed"}</span>
        {printedSheets > 0 && <span>Sheet printed {printedSheets}×</span>}
      </div>

      <table className="mt-4 w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-fg-subtle">
          <tr className="border-b border-line-subtle">
            <th scope="col" className="py-2 pr-3">Item</th>
            <th scope="col" className="py-2 pr-3 text-right">Qty</th>
            <th scope="col" className="w-20 py-2 text-center">Packed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {s.items.map((i) => {
            const on = Boolean(packed[i.orderItemId]);
            return (
              <tr key={i.orderItemId}>
                <td className="py-2.5 pr-3">
                  <span className="block font-medium text-fg">{i.productName}</span>
                  <span className="block text-fg-muted">
                    {[i.size, i.color].filter(Boolean).join(" · ")} <span className="font-mono text-xs text-fg-subtle">{i.sku}</span>
                  </span>
                </td>
                <td className="py-2.5 pr-3 text-right font-display text-lg tabular-nums text-fg">{i.quantity}</td>
                <td className="py-2.5 text-center">
                  <button
                    type="button"
                    onClick={() => onToggle(i.orderItemId)}
                    aria-pressed={on}
                    aria-label={`${on ? "Unmark" : "Mark"} ${i.productName} ${i.size} as packed`}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors duration-fast print:hidden",
                      on ? "border-success-600 bg-success-600 text-white" : "border-line text-transparent hover:border-ink-400",
                    )}
                  >
                    <Check size={15} />
                  </button>
                  <span className="hidden h-5 w-5 rounded border border-ink-500 print:inline-block" aria-hidden="true" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {s.courierNote && <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-sm text-fg-muted print:bg-transparent print:px-0">Courier note: {s.courierNote}</p>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className={cn("print:hidden", done ? "text-success-700" : "text-fg-subtle")}>
          {done ? "Every item checked" : `${formatCount(s.items.filter((i) => packed[i.orderItemId]).length)} of ${formatCount(s.items.length)} lines checked · ${formatCount(s.totalUnits)} units`}
        </span>
        <span className="hidden text-fg print:inline">
          {formatCount(s.totalUnits)} units · Packed by ____________ · Checked by ____________
        </span>
      </div>
    </Card>
  );
}
