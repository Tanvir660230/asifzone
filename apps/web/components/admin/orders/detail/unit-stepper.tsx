"use client";

import { Minus, Plus } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";

/** − n + for a count of units (returns, damaged, came back). Big tap targets: staff use it on a phone at the packing table. */
export function UnitStepper({ label, value, max, onChange, min = 0 }: { label: string; value: number; max: number; min?: number; onChange: (v: number) => void }) {
  return (
    <div className="inline-flex items-center rounded-full border border-line-strong" role="group" aria-label={label}>
      <IconButton aria-label={`${label}: one less`} size="lg" disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus size={14} />
      </IconButton>
      <span className="min-w-8 text-center text-sm tabular-nums" aria-live="polite">
        {value}
      </span>
      <IconButton aria-label={`${label}: one more`} size="lg" disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus size={14} />
      </IconButton>
    </div>
  );
}
