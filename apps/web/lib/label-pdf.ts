import { toJpeg } from "html-to-image";
import { jsPDF } from "jspdf";
import type { LabelTemplate } from "./label-templates";
import { resolveGeometry } from "./label-templates";
import type { CaptureProgress } from "./label-progress";

export interface PageSlot {
  orderId: string;
  /** 0-based — which repeat of this order (see "copies") this slot renders. Doesn't affect capture
   * (the same rasterized image is reused for every copy of a given order) — kept only so preview/
   * debugging can tell slots apart. */
  copyIndex: number;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
}

export interface PageLayout {
  pageIndex: number;
  wMm: number;
  hMm: number;
  slots: PageSlot[];
}

export interface BuildLayoutArgs {
  /** Already the flattened, copy-duplicated, order-preserving sequence of order ids to lay out —
   * see the print-labels page's copies expansion. */
  orderIds: string[];
  template: LabelTemplate;
  orientation: "portrait" | "landscape";
  marginMm: number;
}

/** Pure chunking of orderIds into labelsPerPage-sized pages, with each slot's x/y computed straight
 * from the template's grid — no measurement of actual label content happens here. The template (not
 * the content) always determines how many labels fit on a page, per the fixed set of templates this
 * printer supports. */
export function buildPageLayout({ orderIds, template, orientation, marginMm }: BuildLayoutArgs): PageLayout[] {
  const geometry = resolveGeometry(template, orientation, marginMm);
  const pages: PageLayout[] = [];

  for (let start = 0, pageIndex = 0; start < orderIds.length; start += geometry.labelsPerPage, pageIndex++) {
    const pageOrderIds = orderIds.slice(start, start + geometry.labelsPerPage);
    const copyIndexByOrderId = new Map<string, number>();
    const slots: PageSlot[] = pageOrderIds.map((orderId, i) => {
      const col = i % geometry.columns;
      const row = Math.floor(i / geometry.columns);
      const copyIndex = copyIndexByOrderId.get(orderId) ?? 0;
      copyIndexByOrderId.set(orderId, copyIndex + 1);
      return {
        orderId,
        copyIndex,
        xMm: geometry.marginMm + col * (geometry.cellWmm + geometry.gapMm),
        yMm: geometry.marginMm + row * (geometry.cellHmm + geometry.gapMm),
        wMm: geometry.cellWmm,
        hMm: geometry.cellHmm,
      };
    });
    pages.push({ pageIndex, wMm: geometry.pageWmm, hMm: geometry.pageHmm, slots });
  }

  return pages;
}

export interface CaptureOptions {
  /** Supersampling factor for html-to-image — higher for physically small labels, where the same mm
   * area needs more source pixels to keep the barcode/text crisp. */
  pixelRatio: number;
  onProgress?: (progress: CaptureProgress) => void;
  /** Yield to the browser (via requestAnimationFrame) after every N captures, so a large batch never
   * freezes the tab. Defaults to yielding after every capture. */
  yieldEvery?: number;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Rasterizes each order's off-screen label node to a JPEG data URL — exactly once per unique order,
 * regardless of how many page-slots or copies that order occupies (the caller reuses the same data
 * URL for every repeated slot). Deliberately sequential (not Promise.all): html-to-image captures are
 * CPU-heavy, and a sequential loop with a per-capture rAF yield is what keeps a 50-500 order batch
 * from freezing the tab, while giving the progress callback real per-item granularity.
 *
 * JPEG, not PNG: a first pass used lossless PNG and produced a ~35MB PDF for just 22 labels (4 pages)
 * — anti-aliased text/barcode edges and the embedded logo photo compress terribly under PNG's
 * lossless scheme, and that cost scales linearly with batch size, so a realistic 500-order run would
 * have produced a document in the hundreds of MB, impractical to generate, download, or print. JPEG
 * at quality 0.92 keeps barcodes reliably scannable (verified — bars are large flat black/white
 * regions, not fine detail JPEG artifacts damage) while cutting file size by roughly an order of
 * magnitude. */
export async function captureOrderImages(
  nodesByOrderId: Map<string, HTMLElement>,
  { pixelRatio, onProgress, yieldEvery = 1 }: CaptureOptions,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const entries = Array.from(nodesByOrderId.entries());

  for (let i = 0; i < entries.length; i++) {
    const [orderId, node] = entries[i]!;
    const dataUrl = await toJpeg(node, { pixelRatio, quality: 0.92, backgroundColor: "#ffffff", cacheBust: true });
    result.set(orderId, dataUrl);
    onProgress?.({ done: i + 1, total: entries.length });
    if ((i + 1) % yieldEvery === 0) await yieldToBrowser();
  }

  return result;
}

function pageOrientation(page: PageLayout): "p" | "l" {
  return page.wMm > page.hMm ? "l" : "p";
}

/** Builds the actual PDF: one addImage call per slot, reusing whichever capture (there is exactly
 * one per unique order) that slot's orderId maps to. A slot whose image is missing (a capture that
 * failed) is skipped rather than throwing, so one bad label can't take down the whole batch's PDF. */
export function assemblePdf(pages: PageLayout[], imagesByOrderId: Map<string, string>): jsPDF {
  if (pages.length === 0) throw new Error("Cannot build a PDF with zero pages");
  const first = pages[0]!;
  const doc = new jsPDF({ unit: "mm", format: [first.wMm, first.hMm], orientation: pageOrientation(first), compress: true });

  pages.forEach((page, i) => {
    if (i > 0) doc.addPage([page.wMm, page.hMm], pageOrientation(page));
    for (const slot of page.slots) {
      const src = imagesByOrderId.get(slot.orderId);
      if (!src) continue;
      doc.addImage(src, "JPEG", slot.xMm, slot.yMm, slot.wMm, slot.hMm);
    }
  });

  return doc;
}

/** "Print current page only" is just a 1-page slice through the same assembly path — not a separate
 * PDF builder, so it can never drift from the real multi-page output. */
export function assembleSinglePagePdf(page: PageLayout, imagesByOrderId: Map<string, string>): jsPDF {
  return assemblePdf([{ ...page, pageIndex: 0 }], imagesByOrderId);
}

/** Opens the generated PDF in a hidden iframe and calls native print on it — the OS print dialog is
 * then operating on a real PDF (via the browser's own PDF viewer), which defaults to "Actual size"
 * far more reliably than printing a scaled HTML page ever did. The object URL is revoked on a delay
 * rather than immediately, since removing/revoking too early can silently cancel the print job in
 * some browsers before the dialog has finished reading the blob. */
export function printPdf(doc: jsPDF): void {
  const blobUrl = URL.createObjectURL(doc.output("blob"));
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = blobUrl;
  document.body.appendChild(iframe);
  iframe.onload = () => {
    iframe.contentWindow?.print();
    setTimeout(() => {
      document.body.removeChild(iframe);
      URL.revokeObjectURL(blobUrl);
    }, 60_000);
  };
}

export function downloadPdf(doc: jsPDF, filename: string): void {
  doc.save(filename);
}

/** Pre-fetches the store logo once as a data URL so the off-screen label capture never has to load a
 * cross-origin <img> (StoreSettings.logoUrl lives on the API origin, separate from the web app's own
 * origin, with no confirmed CORS/crossOrigin handling — rasterizing that directly risks either a
 * silently blank logo or a tainted-canvas exception). Returns null on any failure (missing URL,
 * network error, non-OK response) — the caller then omits the logo for the whole batch, falling back
 * to ShippingLabel's existing text-wordmark path, rather than letting one bad image block generation. */
export async function resolveLogoDataUrl(logoUrl: string | null): Promise<string | null> {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
