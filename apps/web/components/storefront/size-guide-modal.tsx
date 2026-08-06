"use client";

import { useState } from "react";
import { Ruler } from "lucide-react";
import { Modal } from "@/components/ui/modal";

const SIZE_CHART = [
  { size: "S", chest: "36–38", waist: "30–32", length: "27" },
  { size: "M", chest: "39–41", waist: "33–35", length: "28" },
  { size: "L", chest: "42–44", waist: "36–38", length: "29" },
  { size: "XL", chest: "45–47", waist: "39–41", length: "30" },
  { size: "XXL", chest: "48–50", waist: "42–44", length: "31" },
];

/** A generic reference chart — not per-product measurements, since the catalog doesn't track
 * those. Good enough for "which size is roughly right for me" without overclaiming precision. */
export function SizeGuideModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-ink-500 underline hover:text-brass-600"
      >
        <Ruler size={12} /> Size guide
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Size guide" widthClassName="max-w-md">
        <p className="mb-4 text-xs text-ink-500">
          General reference in inches. Fit varies slightly by style — when between sizes, we recommend sizing up.
        </p>
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-ink-400">
              <th className="border-b border-ink-100 pb-2">Size</th>
              <th className="border-b border-ink-100 pb-2">Chest (in)</th>
              <th className="border-b border-ink-100 pb-2">Waist (in)</th>
              <th className="border-b border-ink-100 pb-2">Length (in)</th>
            </tr>
          </thead>
          <tbody>
            {SIZE_CHART.map((row) => (
              <tr key={row.size}>
                <td className="border-b border-ink-50 py-2 font-medium text-ink-900">{row.size}</td>
                <td className="border-b border-ink-50 py-2 text-ink-600">{row.chest}</td>
                <td className="border-b border-ink-50 py-2 text-ink-600">{row.waist}</td>
                <td className="border-b border-ink-50 py-2 text-ink-600">{row.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>
    </>
  );
}
