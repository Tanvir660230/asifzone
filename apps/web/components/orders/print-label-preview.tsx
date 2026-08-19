"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import type { PageLayout } from "@/lib/label-pdf";
import { Button } from "@/components/ui/button";

// Matches the reference pixel density CSS `mm` units resolve to in every browser (96 CSS px/inch),
// regardless of the screen's actual physical DPI — used only to size the auto-fit zoom calculation,
// never for anything print-accuracy-related (the PDF itself is built from mm coordinates directly).
const CSS_PX_PER_MM = 96 / 25.4;

interface PrintLabelPreviewProps {
  pages: PageLayout[];
  imagesByOrderId: Map<string, string>;
  currentPageIndex: number;
  onPageChange: (index: number) => void;
}

/** Read-only preview of exactly what the generated PDF contains — every slot renders the same
 * captured image that gets embedded in the PDF, so this is pixel-faithful, not an approximation.
 * Zoom is a plain CSS transform on the page sheet; page navigation just swaps which PageLayout is
 * shown. */
export function PrintLabelPreview({ pages, imagesByOrderId, currentPageIndex, onPageChange }: PrintLabelPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fitZoom, setFitZoom] = useState(1);
  const [zoomMultiplier, setZoomMultiplier] = useState(1);

  const page = pages[currentPageIndex];
  const totalLabels = pages.reduce((sum, p) => sum + p.slots.length, 0);

  const pageWmm = page?.wMm;
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pageWmm) return;
    const pageWidthPx = pageWmm * CSS_PX_PER_MM;
    const measure = () => setFitZoom(Math.min(1, (container.clientWidth - 32) / pageWidthPx));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [pageWmm]);

  // Reset manual zoom whenever the page's own dimensions change (template switch) so a zoom level
  // tuned for one paper size doesn't carry over and look wrong on a very differently-sized one.
  useEffect(() => {
    setZoomMultiplier(1);
  }, [page?.wMm, page?.hMm]);

  if (!page) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink-400">Nothing to preview yet.</div>;
  }

  const zoom = fitZoom * zoomMultiplier;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-600">
        <span>
          Page {currentPageIndex + 1} of {pages.length} · {totalLabels} label{totalLabels === 1 ? "" : "s"} total
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoomMultiplier((z) => Math.max(0.5, z / 1.2))}
            aria-label="Zoom out"
          >
            <ZoomOut size={14} />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums text-ink-500">{Math.round(zoom * 100)}%</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoomMultiplier((z) => Math.min(3, z * 1.2))}
            aria-label="Zoom in"
          >
            <ZoomIn size={14} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPageIndex === 0}
            onClick={() => onPageChange(currentPageIndex - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft size={14} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPageIndex === pages.length - 1}
            onClick={() => onPageChange(currentPageIndex + 1)}
            aria-label="Next page"
          >
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>

      <div ref={containerRef} className="overflow-auto rounded-lg border border-ink-200 bg-ink-50/60 p-4">
        <div style={{ width: page.wMm * CSS_PX_PER_MM * zoom, height: page.hMm * CSS_PX_PER_MM * zoom }}>
          <div
            className="relative bg-white shadow-sm"
            style={{
              width: `${page.wMm}mm`,
              height: `${page.hMm}mm`,
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
            }}
          >
            {page.slots.map((slot, i) => {
              const src = imagesByOrderId.get(slot.orderId);
              return (
                <div
                  key={`${slot.orderId}-${slot.copyIndex}-${i}`}
                  className="absolute border border-dashed border-ink-200"
                  style={{ left: `${slot.xMm}mm`, top: `${slot.yMm}mm`, width: `${slot.wMm}mm`, height: `${slot.hMm}mm` }}
                >
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element -- data URL, not a Next-optimizable asset
                    <img src={src} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-danger-500">Failed to render</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
