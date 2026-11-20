"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Minus, Plus, Printer, Tag, X } from "lucide-react";
import type { ProductLabelVariant } from "@clothing-brand/shared";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { ClassicLabel } from "@/components/admin/product-labels/classic-label";
import { SupplierLists } from "@/components/admin/product-labels/supplier-lists";
import { useStickerImages } from "@/components/admin/product-labels/use-sticker-images";
import { useCapability } from "@/hooks/use-capability";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import * as settingsApi from "@/lib/api/settings";
import * as warehouseApi from "@/lib/api/warehouse";
import { getErrorMessage } from "@/lib/api-client";
import { formatCount } from "@/lib/format";
import { STICKER_SIZES, type StickerSize } from "@/lib/product-sticker";
import type { StickerDpi } from "@/lib/sticker-layout";
import { cn } from "@/lib/utils";

const MAX_PER_PRODUCT = 500;
const SEARCH_LIMIT = 60;
const STICKER_SIZE_KEY = "product-label-size";
const STICKER_DPI_KEY = "product-label-dpi";
type Tab = "print" | "lists";

/** The 50 × 25 sticker is drawn dot for dot (lib/sticker-canvas.ts); the other sizes keep the classic layout. */
const isDotSticker = (s: StickerSize) => s === "50x25";

function useRemembered<T extends string>(key: string, initial: T, valid: (v: string) => boolean): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const saved = localStorage.getItem(key);
    if (saved && valid(saved)) setValue(saved as T);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [
    value,
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, v);
      } catch {
        /* private mode: the choice just isn't kept */
      }
    },
  ];
}

/**
 * Product labels (docs/WAREHOUSE_OPERATIONS.md §3). Print: products from a search, a pick list or a supplier list, one
 * sticker per piece. Supplier lists: what was ordered and what arrived, so the stickers print without typing them again.
 * The 50 × 25 sticker is a bitmap at the printer's own dots — logo, sticker name and tag, SIZE and COLOR, a real Code 128
 * and QR of the code. The print is recorded; nothing else changes.
 */
export default function ProductLabelsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("print");
  const [picked, setPicked] = useState<Map<string, { variant?: ProductLabelVariant; quantity: number }>>(new Map());
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim(), 250);
  const [size, setSize] = useRemembered<StickerSize>(STICKER_SIZE_KEY, "50x25", (v) => v in STICKER_SIZES);
  const [dpiRaw, setDpiRaw] = useRemembered<"203" | "300">(STICKER_DPI_KEY, "203", (v) => v === "203" || v === "300");
  const dpi = Number(dpiRaw) as StickerDpi;
  const [showPrice, setShowPrice] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [handoff, setHandoff] = useState<string[] | null>(null);
  const canSetTagline = useCapability("settings.manage");

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
    queryFn: ({ signal }) => warehouseApi.listProductLabelVariants({ search: q, limit: SEARCH_LIMIT }, { signal }),
    enabled: q.length >= 2,
  });

  const settings = useQuery({ queryKey: ["settings"], queryFn: settingsApi.getSettings });
  const [tagline, setTagline] = useState("");
  useEffect(() => {
    if (settings.data) setTagline(settings.data.settings.labelTagline ?? "");
  }, [settings.data]);
  const saveTagline = useMutation({
    mutationFn: (value: string) => settingsApi.updateSettings({ labelTagline: value.trim() || null }),
    onSuccess: (data) => {
      qc.setQueryData(["settings"], data);
      toast.success("Saved");
    },
    onError: (err) => toast.error(getErrorMessage(err, "Not saved")),
  });

  const rows = useMemo(() => [...picked.entries()].filter(([, r]) => r.variant).map(([id, r]) => ({ id, ...r, variant: r.variant! })), [picked]);
  const totalLabels = rows.reduce((n, r) => n + r.quantity, 0);
  const missingBarcode = rows.filter((r) => !r.variant.barcode).length;
  const dot = isDotSticker(size);

  const brand = settings.data
    ? { logoUrl: settings.data.settings.logoUrl, storeName: settings.data.settings.storeName, tagline: settings.data.settings.labelTagline ?? null }
    : null;
  const variants = useMemo(() => rows.map((r) => r.variant), [rows]);
  const { images, ready } = useStickerImages(variants, dpi, brand, dot);
  const failed = dot ? rows.filter((r) => images.get(r.id)?.ok === false) : [];

  function add(...vs: ProductLabelVariant[]) {
    setPicked((prev) => {
      const next = new Map(prev);
      for (const v of vs) next.set(v.variantId, { variant: v, quantity: Math.min(MAX_PER_PRODUCT, (prev.get(v.variantId)?.quantity ?? 0) + 1) });
      return next;
    });
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

  const dims = STICKER_SIZES[size];
  const found = results.data?.variants ?? [];
  const printBlocked = rows.length === 0 || (dot && (!ready || failed.length > 0));
  const preview = rows[0] ? (dot ? images.get(rows[0].id) : null) : null;

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
            description="One sticker per piece: name, size and colour, with a barcode and QR code the scanner reads."
            action={
              tab === "print" ? (
                <Button size="sm" disabled={printBlocked} loading={printing || (dot && rows.length > 0 && !ready)} onClick={print}>
                  <Printer size={14} /> Print {totalLabels > 0 ? `${formatCount(totalLabels)} labels` : "labels"}
                </Button>
              ) : undefined
            }
          />
        </div>

        <SegmentedControl<Tab>
          aria-label="Product labels"
          value={tab}
          onChange={setTab}
          size="md"
          options={[
            { value: "print", label: "Print" },
            { value: "lists", label: "Supplier lists" },
          ]}
        />

        {tab === "lists" ? (
          <SupplierLists
            onPrint={(list) => {
              setPicked(new Map(list.map((r) => [r.variant.variantId, { variant: r.variant, quantity: Math.min(MAX_PER_PRODUCT, r.quantity) }])));
              setTab("print");
            }}
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <div className="space-y-4">
              <SearchInput value={search} onChange={setSearch} placeholder="Add a product: name, SKU or barcode" aria-label="Search products to label" />
              {q.length >= 2 && (
                <Card className="divide-y divide-line-subtle overflow-hidden p-0">
                  {results.isLoading && <Skeleton className="m-3 h-8" />}
                  {results.isError && <ErrorState variant="plain" description="Search didn't load." onRetry={() => void results.refetch()} />}
                  {results.data?.variants.length === 0 && <p className="p-4 text-sm text-fg-muted">No product matches “{q}”.</p>}
                  {found.length > 1 && (
                    <div className="flex items-center justify-between gap-3 bg-ink-900/[0.02] px-4 py-2 text-sm">
                      <span className="text-fg-muted">
                        {formatCount(found.length)} sizes and colours{found.length === SEARCH_LIMIT ? ` (first ${SEARCH_LIMIT})` : ""}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => add(...found)}>
                        <Plus size={14} /> Add all
                      </Button>
                    </div>
                  )}
                  {found.map((v) => (
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
                <EmptyState variant="bordered" icon={Tag} title="No products yet" description="Search above, open a supplier list, or open a pick list and choose Product labels." />
              ) : (
                <Card className="divide-y divide-line-subtle overflow-hidden p-0">
                  {rows.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="truncate font-medium text-fg">{r.variant.productName}</p>
                        <p className="text-fg-muted">
                          {[r.variant.size, r.variant.color].filter(Boolean).join(" · ")} <span className="font-mono text-xs text-fg-subtle">{r.variant.code}</span>
                        </p>
                        {dot && images.get(r.id)?.ok === false && <p className="text-danger-600">{(images.get(r.id) as { error: string }).error}</p>}
                      </div>
                      <div className="flex items-center gap-1">
                        <IconButton variant="outline" size="sm" aria-label={`One label fewer for ${r.variant.productName} ${r.variant.size}`} onClick={() => setQty(r.id, r.quantity - 1)}>
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
                        <IconButton variant="outline" size="sm" aria-label={`One label more for ${r.variant.productName} ${r.variant.size}`} onClick={() => setQty(r.id, r.quantity + 1)}>
                          <Plus size={14} />
                        </IconButton>
                        <IconButton variant="ghost" size="sm" aria-label={`Remove ${r.variant.productName} ${r.variant.size}`} onClick={() => setQty(r.id, 0)}>
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
                    {(Object.keys(STICKER_SIZES) as StickerSize[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={size === k}
                        onClick={() => setSize(k)}
                        className={cn("rounded-full border px-3 py-1.5 text-sm transition-colors duration-fast", size === k ? "border-ink-900 bg-ink-900 text-white" : "border-line text-fg-muted hover:text-fg")}
                      >
                        {STICKER_SIZES[k].label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                {dot && (
                  <fieldset>
                    <legend className="text-sm font-medium text-fg">Printer</legend>
                    <SegmentedControl<"203" | "300">
                      aria-label="Printer resolution"
                      className="mt-2"
                      value={dpiRaw}
                      onChange={setDpiRaw}
                      options={[
                        { value: "203", label: "203 dpi" },
                        { value: "300", label: "300 dpi" },
                      ]}
                    />
                    <p className="mt-2 text-xs text-fg-muted">Most 2-inch label printers are 203 dpi (Gprinter GP-3120, Xprinter). It&rsquo;s on the printer&rsquo;s box.</p>
                  </fieldset>
                )}
                <p className="text-xs text-fg-muted">Set the printer&rsquo;s paper to {dims.label} too, and print at 100% scale (not “fit to page”).</p>
                {dot && canSetTagline && (
                  <form
                    className="space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveTagline.mutate(tagline);
                    }}
                  >
                    <label htmlFor="sticker-tagline" className="block text-sm font-medium text-fg">
                      Text beside the logo
                    </label>
                    <div className="flex gap-2">
                      <Input id="sticker-tagline" value={tagline} maxLength={40} placeholder="e.g. OUTERWEAR" onChange={(e) => setTagline(e.target.value)} />
                      <Button type="submit" size="sm" variant="outline" disabled={tagline.trim() === (settings.data?.settings.labelTagline ?? "")} loading={saveTagline.isPending}>
                        Save
                      </Button>
                    </div>
                  </form>
                )}
                {!dot && (
                  <label className="flex items-center justify-between gap-3 text-sm text-fg">
                    Show price
                    <Switch checked={showPrice} onChange={setShowPrice} aria-label="Show price on labels" />
                  </label>
                )}
              </Card>
              {!dot && missingBarcode > 0 && (
                <Alert variant="info" title={`${missingBarcode} ${missingBarcode === 1 ? "product has" : "products have"} no barcode`}>
                  Their labels carry the SKU instead, which the scanner reads the same way. Add a barcode on the product to use your own.
                </Alert>
              )}
              {dot && settings.isError && <ErrorState variant="plain" description="The store's logo didn't load." onRetry={() => void settings.refetch()} />}
              {rows[0] && (
                <div>
                  <p className="mb-2 text-xs text-fg-subtle">Preview, shown larger than the {dims.label} sticker</p>
                  {dot ? (
                    preview?.ok ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={preview.image.url}
                        alt={`Sticker for ${rows[0].variant.productName} ${rows[0].variant.size}`}
                        data-testid="product-sticker-preview"
                        className="w-full max-w-[22rem] rounded-md border border-line bg-white shadow-sm [image-rendering:pixelated]"
                      />
                    ) : preview && !preview.ok ? (
                      <Alert variant="warning" title="This sticker can't be printed">{preview.error}</Alert>
                    ) : (
                      <Skeleton className="aspect-[2/1] w-full max-w-[22rem]" />
                    )
                  ) : (
                    <div className="inline-block rounded-md border border-line bg-white shadow-sm" style={{ zoom: 1.6 }}>
                      <ClassicLabel v={rows[0].variant} size={size} showPrice={showPrice} />
                    </div>
                  )}
                  {dot && (
                    <p className="mt-2 text-xs text-fg-muted">
                      Sticker name and tag come from each product&rsquo;s <span className="font-medium">Sticker</span> fields; empty, the product name is used.
                    </p>
                  )}
                </div>
              )}
            </aside>
          </div>
        )}
      </div>

      {/* What the printer gets: one label per page. */}
      <div className="hidden print:!mt-0 print:block [&>*:last-child]:break-after-auto" aria-hidden="true">
        {rows.flatMap((r) =>
          Array.from({ length: r.quantity }, (_, i) => {
            if (!dot) return <ClassicLabel key={`${r.id}-${i}`} v={r.variant} size={size} showPrice={showPrice} printed />;
            const img = images.get(r.id);
            return img?.ok ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${r.id}-${i}`}
                src={img.image.url}
                alt=""
                data-testid="product-sticker"
                data-code={r.variant.code}
                className="block break-after-page [image-rendering:pixelated]"
                style={{ width: `${dims.widthMm}mm`, height: `${dims.heightMm}mm` }}
              />
            ) : null;
          }),
        )}
      </div>
    </div>
  );
}
