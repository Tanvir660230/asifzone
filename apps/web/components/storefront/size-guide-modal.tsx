"use client";

import { useState } from "react";
import { Ruler } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

interface SizeGuideProps {
  sizeGuide?: {
    enabled?: boolean;
    title?: string;
    unit?: string;
    columns: string[];
    rows: string[][] | string[][];
  };
}

const DEFAULT_SIZE_CHART = {
  title: "Size guide",
  unit: "inch",
  columns: ["Size", "Chest", "Waist", "Length"],
  rows: [
    ["S", "36–38", "30–32", "27"],
    ["M", "39–41", "33–35", "28"],
    ["L", "42–44", "36–38", "29"],
    ["XL", "45–47", "39–41", "30"],
    ["XXL", "48–50", "42–44", "31"],
  ],
};

export function SizeGuideModal({ sizeGuide }: SizeGuideProps) {
  const [open, setOpen] = useState(false);

  if (sizeGuide && sizeGuide.enabled === false) {
    return null;
  }

  const chart = (sizeGuide && sizeGuide.enabled && sizeGuide.columns?.length > 0) ? sizeGuide : DEFAULT_SIZE_CHART;

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

