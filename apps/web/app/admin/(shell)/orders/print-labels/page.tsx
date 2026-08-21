"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Info, Loader2, Printer } from "lucide-react";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import * as settingsApi from "@/lib/api/settings";
import { DEFAULT_TEMPLATE_ID, getTemplate, resolveGeometry } from "@/lib/label-templates";
import {
  buildPageLayout,
  captureOrderImages,
  assemblePdf,
  assembleSinglePagePdf,
  printPdf,
  downloadPdf,
  resolveLogoDataUrl,
  type PageLayout,
} from "@/lib/label-pdf";
import { LabelCaptureHost } from "@/components/orders/label-capture-host";
import { PrintLabelPreview } from "@/components/orders/print-label-preview";
import { PrintLabelOptions, type PrintOptions, type CaptureState } from "@/components/orders/print-label-options";

function buildFilename(orderCount: number): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 5).replace(":", "-");
  return `Shipping-Labels_${dateStr}_${timeStr}_${orderCount}orders.pdf`;
}

export default function PrintLabelsPage() {
  const [ids, setIds] = useState<string[] | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(adminOrdersApi.PRINT_LABEL_ORDER_IDS_KEY);
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      setIds(Array.isArray(parsed) ? parsed : []);
    } catch {
      setIds([]);
    }
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-orders-bulk", ids],
    queryFn: () => adminOrdersApi.bulkGetOrders(ids!),
    enabled: Boolean(ids?.length),
  });
  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: settingsApi.getSettings });

  const orders = useMemo(() => data?.orders ?? [], [data]);

  const [options, setOptions] = useState<PrintOptions>(() => ({
    templateId: DEFAULT_TEMPLATE_ID,
    orientation: "portrait",
    marginMm: getTemplate(DEFAULT_TEMPLATE_ID).defaultMarginMm,
    copies: 1,
    selectedOrderIds: new Set<string>(),
  }));

  // Default to "every loaded order selected" exactly once — a ref guard (not a size===0 check) so
  // intentionally deselecting everything later doesn't get silently re-selected on the next render.
  const didInitSelection = useRef(false);
  useEffect(() => {
    if (orders.length === 0 || didInitSelection.current) return;
    didInitSelection.current = true;
    setOptions((prev) => ({ ...prev, selectedOrderIds: new Set(orders.map((o) => o.id)) }));
  }, [orders]);

  const selectedOrders = useMemo(
    () => orders.filter((o) => options.selectedOrderIds.has(o.id)),
    [orders, options.selectedOrderIds],
  );

  const template = getTemplate(options.templateId);
  const geometry = useMemo(
    () => resolveGeometry(template, options.orientation, options.marginMm),
    [template, options.orientation, options.marginMm],
  );

  // Identifies a capture "generation" — LabelCaptureHost is mounted under this key (see its own doc
  // comment for why a key-based remount, not an internal reset effect, is what makes resets race-free).
  // Margin/orientation are deliberately excluded: those only resize the already-captured content
  // (handled by the host's geometry-driven re-fire), not which labels need to redraw from scratch.
  const captureKey = useMemo(
    () => `${template.id}:${selectedOrders.map((o) => o.id).join(",")}`,
    [template.id, selectedOrders],
  );

  function handleOptionsChange(patch: Partial<PrintOptions>) {
    setOptions((prev) => {
      const next = { ...prev, ...patch };
      if (patch.templateId && patch.templateId !== prev.templateId) {
        const nextTemplate = getTemplate(patch.templateId);
        next.marginMm = nextTemplate.defaultMarginMm;
        if (!nextTemplate.orientationSwappable) next.orientation = "portrait";
      }
      return next;
    });
  }

  function handleToggleOrder(orderId: string) {
    setOptions((prev) => {
      const next = new Set(prev.selectedOrderIds);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return { ...prev, selectedOrderIds: next };
    });
  }

  function handleToggleAll() {
    setOptions((prev) => ({
      ...prev,
      selectedOrderIds: prev.selectedOrderIds.size === orders.length ? new Set() : new Set(orders.map((o) => o.id)),
    }));
  }

  // Logo pre-fetch — resolved once per settings load into a data URL so the off-screen capture never
  // touches a cross-origin <img> (see resolveLogoDataUrl's own doc comment). Falls back to null (text
  // wordmark) on any failure rather than blocking generation.
  const [logo, setLogo] = useState<{ resolved: boolean; dataUrl: string | null }>({ resolved: false, dataUrl: null });
  useEffect(() => {
    if (!settingsData) return;
    let cancelled = false;
    setLogo({ resolved: false, dataUrl: null });
    resolveLogoDataUrl(settingsData.settings.logoUrl ?? null).then((dataUrl) => {
      if (!cancelled) setLogo({ resolved: true, dataUrl });
    });
    return () => {
      cancelled = true;
    };
  }, [settingsData]);

  const storeForRender = useMemo(() => {
    if (!settingsData) return undefined;
    return { ...settingsData.settings, logoUrl: logo.dataUrl };
  }, [settingsData, logo.dataUrl]);

  const readyToCapture = Boolean(settingsData) && logo.resolved && selectedOrders.length > 0;

  const [captureState, setCaptureState] = useState<CaptureState>({ phase: "idle" });
  const [imagesByOrderId, setImagesByOrderId] = useState<Map<string, string>>(new Map());
  const [pages, setPages] = useState<PageLayout[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  // The true recapture triggers — anything that changes what the off-screen labels look like or how
  // big they render. Sets an optimistic "capturing" state immediately so the copies-only rebuild
  // effect below can't act on stale images while this is in flight. `copies` is deliberately absent:
  // it only affects how the *existing* captured images get laid out, not their content/size.
  useEffect(() => {
    if (selectedOrders.length === 0) {
      setCaptureState({ phase: "idle" });
      setPages([]);
      return;
    }
    setCaptureState({ phase: "capturing", progress: { done: 0, total: selectedOrders.length } });
  }, [options.templateId, options.orientation, options.marginMm, selectedOrders]);

  function buildLayoutFor(copies: number): PageLayout[] {
    const orderIdSequence = selectedOrders.flatMap((o) => Array<string>(copies).fill(o.id));
    return buildPageLayout({ orderIds: orderIdSequence, template, orientation: options.orientation, marginMm: options.marginMm });
  }

  async function handleHostReady(nodes: Map<string, HTMLElement>) {
    if (nodes.size === 0) {
      setImagesByOrderId(new Map());
      setPages([]);
      setCaptureState({ phase: "idle" });
      return;
    }
    try {
      const images = await captureOrderImages(nodes, {
        pixelRatio: template.kind === "sticker" ? 4 : 3,
        onProgress: (progress) => setCaptureState({ phase: "capturing", progress }),
      });
      setImagesByOrderId(images);
      setPages(buildLayoutFor(options.copies));
      setCurrentPageIndex(0);
      setCaptureState({ phase: "ready" });
    } catch (err) {
      setCaptureState({ phase: "error", message: err instanceof Error ? err.message : "Failed to render labels" });
    }
  }

  // Copies-only rebuild — reuses whatever's already captured; only proceeds once a real capture has
  // actually settled ("ready"), so a copies edit that lands mid-recapture doesn't lay out stale images.
  useEffect(() => {
    if (captureState.phase !== "ready") return;
    const layout = buildLayoutFor(options.copies);
    setPages(layout);
    setCurrentPageIndex((idx) => Math.min(idx, Math.max(0, layout.length - 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only `copies` should trigger this rebuild
  }, [options.copies]);

  function handlePrintAllPages() {
    if (pages.length === 0) return;
    printPdf(assemblePdf(pages, imagesByOrderId));
  }

  function handlePrintCurrentPage() {
    const page = pages[currentPageIndex];
    if (!page) return;
    printPdf(assembleSinglePagePdf(page, imagesByOrderId));
  }

  function handleDownload() {
    if (pages.length === 0) return;
    downloadPdf(assemblePdf(pages, imagesByOrderId), buildFilename(selectedOrders.length));
  }

  if (ids === null || (ids.length > 0 && isLoading)) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-ink-400">
        <Loader2 size={28} className="animate-spin" />
        <p className="text-sm">Loading labels…</p>
      </div>
    );
  }

  if (ids.length === 0 || !data?.orders.length) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ink-100 text-ink-400">
          <Printer size={22} />
        </div>
        <p className="text-ink-500">No orders selected for printing.</p>
        <Link
          href="/admin/orders"
          className="inline-flex items-center gap-1 text-sm font-medium text-brass-600 hover:underline"
        >
          <ArrowLeft size={14} /> Back to Orders
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-50/60">
      {/* Fully opaque, not `.glass` — same reasoning as notification-bell.tsx: this floats over the
          scrolling label list, and translucency there let row text visibly bleed/cut through the
          bar's bottom edge as it scrolled underneath. */}
      <div className="sticky top-14 z-10 border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-4 sm:px-10">
          <Link
            href="/admin/orders"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="font-display text-xl text-ink-900">Print Shipping Labels</h1>
            <p className="text-xs text-ink-500">
              {orders.length} order{orders.length === 1 ? "" : "s"} loaded
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl p-6 sm:p-10">
        <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-ink-200 bg-white px-4 py-3 text-xs leading-relaxed text-ink-600">
          <Info size={15} className="mt-0.5 shrink-0 text-ink-400" />
          <p>
            This generates a real, exact-size PDF — in the print dialog it opens, confirm{" "}
            <strong className="text-ink-900">Actual size / 100%</strong> is selected (not &ldquo;Fit to page&rdquo;), so every
            label prints at its true physical dimensions.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          <div className="rounded-xl border border-ink-200 bg-white p-4 lg:sticky lg:top-32 lg:self-start">
            <PrintLabelOptions
              orders={orders}
              options={options}
              onOptionsChange={handleOptionsChange}
              onToggleOrder={handleToggleOrder}
              onToggleAll={handleToggleAll}
              captureState={captureState}
              onPrintAllPages={handlePrintAllPages}
              onPrintCurrentPage={handlePrintCurrentPage}
              onDownload={handleDownload}
            />
          </div>

          <div className="rounded-xl border border-ink-200 bg-white p-4">
            {pages.length > 0 ? (
              <PrintLabelPreview
                pages={pages}
                imagesByOrderId={imagesByOrderId}
                currentPageIndex={currentPageIndex}
                onPageChange={setCurrentPageIndex}
              />
            ) : (
              <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-sm text-ink-400">
                <Loader2 size={22} className={captureState.phase === "capturing" ? "animate-spin" : "opacity-0"} />
                <p>{captureState.phase === "capturing" ? "Rendering preview…" : "Select at least one order to preview."}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {readyToCapture && (
        <LabelCaptureHost
          key={captureKey}
          orders={selectedOrders}
          store={storeForRender}
          template={template}
          geometry={geometry}
          onReady={handleHostReady}
        />
      )}
    </div>
  );
}
