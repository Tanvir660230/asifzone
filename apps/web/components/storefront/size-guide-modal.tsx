"use client";

import { useState } from "react";
import { Ruler } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { DEFAULT_SIZE_GUIDE, type SizeGuideData } from "@clothing-brand/shared";
import { cn } from "@/lib/utils";

interface SizeGuideProps {
  /** The product's own chart; falls back to the shared default chart when absent or empty. */
  sizeGuide?: SizeGuideData;
}

export function SizeGuideModal({ sizeGuide }: SizeGuideProps) {
  const [open, setOpen] = useState(false);

  if (sizeGuide && sizeGuide.enabled === false) {
    return null;
  }

  const chart = sizeGuide && sizeGuide.columns?.length > 0 ? sizeGuide : DEFAULT_SIZE_GUIDE;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-ink-500 underline hover:text-brass-600"
      >
        <Ruler size={12} /> Size guide
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={chart.title || "Size guide"} widthClassName="max-w-md">
        <p className="mb-4 text-xs text-ink-500">
          All measurements are in {chart.unit || "inches"}. Fit varies slightly by style — when between sizes, we recommend sizing up.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-ink-400">
                {chart.columns.map((col: string, idx: number) => (
                  <th key={idx} className="border-b border-ink-100 pb-2 px-2 first:pl-0">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chart.rows.map((row: string[], rIdx: number) => (
                <tr key={rIdx}>
                  {row.map((cell: string, cIdx: number) => (
                    <td key={cIdx} className={cn("border-b border-ink-50 py-2 px-2 first:pl-0 text-ink-600", cIdx === 0 && "font-medium text-ink-900")}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </>
  );
}
