import { getFontEmbedCSS, toCanvas } from "html-to-image";
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
  /** Supersampling factor for html-to-image — see pixelRatioFor. */
  pixelRatio: number;
  /** Thermal printers: threshold every pixel to pure black or white (see toThermal). */
  mono: boolean;
  onProgress?: (progress: CaptureProgress) => void;
  /** Yield to the browser (via requestAnimationFrame) after every N captures, so a large batch never
   * freezes the tab. Defaults to yielding after every capture. */
  yieldEvery?: number;
}

/** Thermal printers print dots, not greys: a 203-dpi head has exactly 8 dots per mm. Rendering at exactly twice the
 * head's resolution (an even multiple, so the driver's downscale lands on whole dots) keeps text edges and barcode
 * bars on the dot grid instead of smearing them across two. A4 sheets on an ordinary printer keep 3×. */
export function pixelRatioFor(kind: "a4" | "sticker", printerDpi: number): number {
  return kind === "sticker" ? (printerDpi * 2) / 96 : 3;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Threshold to pure black and white. A thermal driver otherwise dithers every anti-aliased edge and every dark-grey
 * pixel into a scatter of dots — the "broken", faint-looking text and fuzzy barcode edges on real prints. 160 (of 255)
 * keeps thin Bangla strokes whole while dropping JPEG-style haze; the result is also a small two-colour PNG. */
export function thresholdPixels(px: Uint8ClampedArray, cutoff = 160): void {
  for (let i = 0; i < px.length; i += 4) {
    const luma = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
    const v = luma < cutoff ? 0 : 255;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
}

function toThermal(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  thresholdPixels(image.data);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Rasterizes each order's off-screen label node — exactly once per unique order, however many page slots or copies
 * it occupies (the caller reuses the image for every repeated slot). Sequential with a per-capture rAF yield, so a
 * 50-500 order batch never freezes the tab and progress moves per label.
 *
 * Fonts: the web-font CSS is built once and handed to every capture. Before, html-to-image re-fetched and re-inlined
 * every font file for every label (cacheBust made each fetch miss the cache) — slow, and a fetch that failed
 * mid-batch silently drew that label in a fallback font whose wider glyphs no longer fit the layout.
 *
 * Output: thermal labels → thresholded PNG (crisp, and small because it's two colours); A4 → JPEG 0.92 (a full colour
 * sheet with a logo photo is ~10× smaller as JPEG, and an office printer handles greys fine). */
export async function captureOrderImages(
  nodesByOrderId: Map<string, HTMLElement>,
  { pixelRatio, mono, onProgress, yieldEvery = 1 }: CaptureOptions,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const entries = Array.from(nodesByOrderId.entries());
  if (entries.length === 0) return result;
  const fontEmbedCSS = await getFontEmbedCSS(entries[0]![1]);

  for (let i = 0; i < entries.length; i++) {
    const [orderId, node] = entries[i]!;
    const canvas = await toCanvas(node, { pixelRatio, backgroundColor: "#ffffff", fontEmbedCSS });
    result.set(orderId, mono ? toThermal(canvas).toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.92));
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
/** Printer nudge, in mm: a printer that lands every sticker a little off (gap sensor, roll guide) is corrected by
 * moving the whole image the other way — read off the test page (buildTestPagePdf). Positive = right / down. */
export interface PrintOffset {
  xMm: number;
  yMm: number;
}

export const NO_OFFSET: PrintOffset = { xMm: 0, yMm: 0 };

export function assemblePdf(pages: PageLayout[], imagesByOrderId: Map<string, string>, offset: PrintOffset = NO_OFFSET): jsPDF {
  if (pages.length === 0) throw new Error("Cannot build a PDF with zero pages");
  const first = pages[0]!;
  const doc = new jsPDF({ unit: "mm", format: [first.wMm, first.hMm], orientation: pageOrientation(first), compress: true });

  pages.forEach((page, i) => {
    if (i > 0) doc.addPage([page.wMm, page.hMm], pageOrientation(page));
    for (const slot of page.slots) {
      const src = imagesByOrderId.get(slot.orderId);
      if (!src) continue;
      const format = src.startsWith("data:image/png") ? "PNG" : "JPEG";
      // The alias makes jsPDF embed each order's image once, however many copies/slots reuse it.
      doc.addImage(src, format, slot.xMm + offset.xMm, slot.yMm + offset.yMm, slot.wMm, slot.hMm, slot.orderId, "FAST");
    }
  });

  return doc;
}

/** "Print current page only" is just a 1-page slice through the same assembly path — not a separate
 * PDF builder, so it can never drift from the real multi-page output. */
export function assembleSinglePagePdf(page: PageLayout, imagesByOrderId: Map<string, string>, offset: PrintOffset = NO_OFFSET): jsPDF {
  return assemblePdf([{ ...page, pageIndex: 0 }], imagesByOrderId, offset);
}

/** One page at the label's exact size that shows what the printer really does with it: a frame 1mm inside every edge,
 * corner marks, mm rulers along the top and left, and a centre cross. On the real roll, a missing frame edge is the
 * side being cut (paper size set wrong, or the sticker drifting) and the rulers read off by how much — the number for
 * the offset fields. Vector with Latin text only, so no fonts or capture are involved. */
export function buildTestPagePdf(wMm: number, hMm: number, offset: PrintOffset = NO_OFFSET): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: [wMm, hMm], orientation: wMm > hMm ? "l" : "p", compress: true });
  const { xMm: ox, yMm: oy } = offset;
  doc.setDrawColor(0);
  doc.setTextColor(0);
  doc.setLineWidth(0.3);
  doc.rect(ox + 1, oy + 1, wMm - 2, hMm - 2);
  doc.setLineWidth(0.6);
  const corners: Array<[number, number, number, number]> = [
    [0, 0, 1, 1],
    [wMm, 0, -1, 1],
    [0, hMm, 1, -1],
    [wMm, hMm, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    doc.line(ox + cx + dx * 2, oy + cy + dy * 2, ox + cx + dx * 8, oy + cy + dy * 2);
    doc.line(ox + cx + dx * 2, oy + cy + dy * 2, ox + cx + dx * 2, oy + cy + dy * 8);
  }
  doc.setLineWidth(0.2);
  doc.setFontSize(5);
  for (let x = 0; x <= Math.floor(wMm); x++) {
    const tick = x % 10 === 0 ? 3 : x % 5 === 0 ? 2 : 1;
    doc.line(ox + x, oy + 1, ox + x, oy + 1 + tick);
    if (x % 10 === 0 && x > 0 && x < wMm - 3) doc.text(String(x), ox + x, oy + 6.2, { align: "center" });
  }
  for (let y = 0; y <= Math.floor(hMm); y++) {
    const tick = y % 10 === 0 ? 3 : y % 5 === 0 ? 2 : 1;
    doc.line(ox + 1, oy + y, ox + 1 + tick, oy + y);
    if (y % 10 === 0 && y > 0 && y < hMm - 3) doc.text(String(y), ox + 5, oy + y + 0.9);
  }
  doc.line(ox + wMm / 2 - 4, oy + hMm / 2, ox + wMm / 2 + 4, oy + hMm / 2);
  doc.line(ox + wMm / 2, oy + hMm / 2 - 4, ox + wMm / 2, oy + hMm / 2 + 4);
  doc.setFontSize(Math.max(6, Math.min(11, wMm / 6)));
  doc.text("PRINTER TEST", ox + wMm / 2, oy + hMm / 2 - 7, { align: "center" });
  doc.setFontSize(Math.max(5, Math.min(8, wMm / 8)));
  doc.text(`${wMm} x ${hMm} mm`, ox + wMm / 2, oy + hMm / 2 + 8, { align: "center" });
  doc.text("All 4 frame edges must print", ox + wMm / 2, oy + hMm / 2 + 12, { align: "center", maxWidth: wMm - 10 });
  return doc;
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
 * to LabelCard's text-wordmark header, rather than letting one bad image block generation. */
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
