"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Minus, Plus, Printer, Tag, X } from "lucide-react";
import type { ProductLabelVariant } from "@clothing-brand/shared";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { SearchInput } from "@/components/ui/search-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { BarcodeSvg } from "@/components/orders/barcode-svg";
import { QrCodeSvg } from "@/components/orders/qr-code-svg";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import * as warehouseApi from "@/lib/api/warehouse";
import { getErrorMessage } from "@/lib/api-client";
import { formatCount, formatPriceWhole } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Sticker sizes the label printers in use take. */
const LABEL_SIZES = {
  "50x30": { label: "50 × 30 mm sticker", page: "50mm 30mm", w: "50mm", h: "30mm" },
  "38x25": { label: "38 × 25 mm sticker", page: "38mm 25mm", w: "38mm", h: "25mm" },
} as const;
type LabelSize = keyof typeof LABEL_SIZES;
const MAX_PER_PRODUCT = 500;

/**
 * Product labels (docs/WAREHOUSE_OPERATIONS.md §3): a barcode and a QR code per unit, both carrying the variant's own
 * barcode (or its SKU when it has none), with the name, size and colour. Products come from a pick list or a search. The
 * print is recorded; nothing else changes.
 */
export default function ProductLabelsPage() {
  const [picked, setPicked] = useState<Map<string, { variant?: ProductLabelVariant; quantity: number }>>(new Map());
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim(), 250);
  const [size, setSize] = useState<LabelSize>("50x30");
  const [showPrice, setShowPrice] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [handoff, setHandoff] = useState<string[] | null>(null);

  // Handed over from a pick list: its variants, a label per unit.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(warehouseApi.PRODUCT_LABEL_SELECTION_KEY);
      sessionStorage.removeItem(warehouseApi.PRODUCT_LABEL_SELECTION_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const rows = parsed.filter((r): r is { variantId: string; quantity: number } => typeof r?.variantId === "string" && Number.isInteger(r?.quantity));
        setPicked(new Map(rows.map((r) => [r.variantId, { quantity: Math.min(MAX_PER_PRODUCT, Math.max(1, r.quantity)) }])));
        setHandoff(rows.map((r) => r.variantId));
      }
    } catch {
      /* nothing handed over */
    }
  }, []);

  const handed = useQuery({
    queryKey: ["warehouse", "label-variants", handoff],
    queryFn: () => warehouseApi.listProductLabelVariants({ variantIds: handoff!, limit: 500 }),
    enabled: Boolean(handoff?.length),
  });
  useEffect(() => {
    if (!handed.data) return;
    setPicked((prev) => {
      const next = new Map(prev);
      for (const v of handed.data.variants) next.set(v.variantId, { variant: v, quantity: prev.get(v.variantId)?.quantity ?? 1 });
      return next;
    });
  }, [handed.data]);

  const results = useQuery({
    queryKey: ["warehouse", "label-search", q],
    queryFn: ({ signal }) => warehouseApi.listProductLabelVariants({ search: q, limit: 30 }, { signal }),
    enabled: q.length >= 2,
  });

  const rows = useMemo(() => [...picked.entries()].filter(([, r]) => r.variant).map(([id, r]) => ({ id, ...r, variant: r.variant! })), [picked]);
  const totalLabels = rows.reduce((n, r) => n + r.quantity, 0);
  const missingBarcode = rows.filter((r) => !r.variant.barcode).length;

  function add(v: ProductLabelVariant) {
    setPicked((prev) => new Map(prev).set(v.variantId, { variant: v, quantity: (prev.get(v.variantId)?.quantity ?? 0) + 1 }));
  }
  function setQty(id: string, quantity: number) {
    setPicked((prev) => {
      const next = new Map(prev);
      const cur = next.get(id);
      if (!cur) return prev;
      if (quantity <= 0) next.delete(id);
      else next.set(id, { ...cur, quantity: Math.min(MAX_PER_PRODUCT, quantity) });
      return next;
    });
  }

  async function print() {
    if (rows.length === 0) return;
    setPrinting(true);
    try {
      await warehouseApi.recordPrintRun({ kind: "PRODUCT_LABEL", clientRunId: warehouseApi.newPrintRunId(), variants: rows.map((r) => ({ variantId: r.id, quantity: r.quantity })) });
    } catch (err) {
      toast.error(getErrorMessage(err, "Printing, but this print wasn't recorded in the print log"));
    }
    requestAnimationFrame(() => {
      window.print();
      setPrinting(false);
    });
  }

  const dims = LABEL_SIZES[size];

  return (
    <div className="space-y-6">
      {/* The sticker printer's page is one label; the screen layout is hidden while printing. */}
      <style>{`@media print { @page { size: ${dims.page}; margin: 0; } }`}</style>
      <div className="space-y-6 print:hidden">
        <div>
          <Link href="/admin/orders/today" className="mb-3 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft size={14} /> Today
          </Link>
          <PageHeader
            title="Product labels"
            description="A barcode and a QR code per unit. Scanners read the product's own barcode, or its SKU when it has none."
            action={
              <Button size="sm" disabled={rows.length === 0} loading={printing} onClick={print}>
                <Printer size={14} /> Print {totalLabels > 0 ? `${formatCount(totalLabels)} labels` : "labels"}
              </Button>
            }
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="space-y-4">
            <SearchInput value={search} onChange={setSearch} placeholder="Add a product: name, SKU or barcode" aria-label="Search products to label" />
            {q.length >= 2 && (
              <Card className="divide-y divide-line-subtle overflow-hidden p-0">
                {results.isLoading && <Skeleton className="m-3 h-8" />}
                {results.isError && <ErrorState variant="plain" description="Search didn't load." onRetry={() => void results.refetch()} />}
                {results.data?.variants.length === 0 && <p className="p-4 text-sm text-fg-muted">No product matches “{q}”.</p>}
                {results.data?.variants.map((v) => (
                  <button key={v.variantId} type="button" onClick={() => add(v)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-ink-900/[0.03]">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-fg">{v.productName}</span>
                      <span className="block text-fg-muted">
                        {[v.size, v.color].filter(Boolean).join(" · ")} <span className="font-mono text-xs text-fg-subtle">{v.sku}</span>
                      </span>
                    </span>
                    <Plus size={16} className="shrink-0 text-fg-subtle" aria-hidden="true" />
                  </button>
                ))}
              </Card>
            )}

            {handed.isLoading && <Skeleton className="h-24 w-full" />}
            {rows.length === 0 && !handed.isLoading ? (
              <EmptyState variant="bordered" icon={Tag} title="No products yet" description="Search above, or open a pick list and choose Product labels." />
            ) : (
              <Card className="divide-y divide-line-subtle overflow-hidden p-0">
                {rows.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="truncate font-medium text-fg">{r.variant.productName}</p>
                      <p className="text-fg-muted">
                        {[r.variant.size, r.variant.color].filter(Boolean).join(" · ")} <span className="font-mono text-xs text-fg-subtle">{r.variant.code}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <IconButton variant="outline" size="sm" aria-label={`One label fewer for ${r.variant.productName}`} onClick={() => setQty(r.id, r.quantity - 1)}>
                        <Minus size={14} />
                      </IconButton>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={MAX_PER_PRODUCT}
                        value={r.quantity}
                        onChange={(e) => setQty(r.id, Number.parseInt(e.target.value || "0", 10))}
                        aria-label={`Labels for ${r.variant.productName} ${r.variant.size}`}
                        className="h-8 w-14 rounded-md border border-line bg-surface text-center text-base tabular-nums sm:text-sm"
                      />
                      <IconButton variant="outline" size="sm" aria-label={`One label more for ${r.variant.productName}`} onClick={() => setQty(r.id, r.quantity + 1)}>
                        <Plus size={14} />
                      </IconButton>
                      <IconButton variant="ghost" size="sm" aria-label={`Remove ${r.variant.productName}`} onClick={() => setQty(r.id, 0)}>
                        <X size={14} />
                      </IconButton>
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </div>

          <aside className="space-y-4">
            <Card className="space-y-4 p-4">
              <fieldset>
                <legend className="text-sm font-medium text-fg">Sticker size</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(Object.keys(LABEL_SIZES) as LabelSize[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={size === k}
                      onClick={() => setSize(k)}
                      className={cn("rounded-full border px-3 py-1.5 text-sm transition-colors duration-fast", size === k ? "border-ink-900 bg-ink-900 text-white" : "border-line text-fg-muted hover:text-fg")}
                    >
                      {LABEL_SIZES[k].label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="flex items-center justify-between gap-3 text-sm text-fg">
                Show price
                <Switch checked={showPrice} onChange={setShowPrice} aria-label="Show price on labels" />
              </label>
            </Card>
            {missingBarcode > 0 && (
              <Alert variant="info" title={`${missingBarcode} ${missingBarcode === 1 ? "product has" : "products have"} no barcode`}>
                Their labels carry the SKU instead, which the scanner reads the same way. Add a barcode on the product to use your own.
              </Alert>
            )}
            {rows[0] && (
              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-fg-subtle">Preview</p>
                <div className="inline-block rounded-md border border-line bg-white shadow-sm">
                  <ProductLabel v={rows[0].variant} w={dims.w} h={dims.h} showPrice={showPrice} />
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>

      {/* What the printer gets: one label per page. */}
      <div className="hidden print:block" aria-hidden="true">
        {rows.flatMap((r) => Array.from({ length: r.quantity }, (_, i) => <ProductLabel key={`${r.id}-${i}`} v={r.variant} w={dims.w} h={dims.h} showPrice={showPrice} printed />))}
      </div>
    </div>
  );
}

function ProductLabel({ v, w, h, showPrice, printed }: { v: ProductLabelVariant; w: string; h: string; showPrice: boolean; printed?: boolean }) {
  return (
    <div style={{ width: w, height: h }} className={cn("flex overflow-hidden bg-white p-[1.5mm] text-black", printed && "break-after-page")}>
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[7pt] font-semibold">{v.productName}</p>
          <p className="truncate text-[6.5pt]">
            {[v.size, v.color].filter(Boolean).join(" · ")}
            {showPrice && v.price != null && <span className="font-semibold"> · {formatPriceWhole(v.price)}</span>}
          </p>
        </div>
        <div className="h-[45%] w-full">
          <BarcodeSvg value={v.code} fill displayValue={false} />
        </div>
        <p className="truncate font-mono text-[6pt]">{v.code}</p>
      </div>
      <div className="ml-[1mm] aspect-square h-full shrink-0">
        <QrCodeSvg value={v.code} fill />
      </div>
    </div>
  );
}
