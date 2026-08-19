"use client";

import { Download, Printer, FileText } from "lucide-react";
import type { Order } from "@clothing-brand/shared";
import { LABEL_TEMPLATES, getTemplate, type LabelTemplateId } from "@/lib/label-templates";
import type { CaptureProgress } from "@/lib/label-progress";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

export interface PrintOptions {
  templateId: LabelTemplateId;
  orientation: "portrait" | "landscape";
  marginMm: number;
  copies: number;
  selectedOrderIds: Set<string>;
}

export type CaptureState =
  | { phase: "idle" }
  | { phase: "capturing"; progress: CaptureProgress }
  | { phase: "ready" }
  | { phase: "error"; message: string };

interface PrintLabelOptionsProps {
  orders: Order[];
  options: PrintOptions;
  onOptionsChange: (patch: Partial<PrintOptions>) => void;
  onToggleOrder: (orderId: string) => void;
  onToggleAll: () => void;
  captureState: CaptureState;
  onPrintAllPages: () => void;
  onPrintCurrentPage: () => void;
  onDownload: () => void;
}

const A4_TEMPLATES = LABEL_TEMPLATES.filter((t) => t.kind === "a4");
const STICKER_TEMPLATES = LABEL_TEMPLATES.filter((t) => t.kind === "sticker");

export function PrintLabelOptions({
  orders,
  options,
  onOptionsChange,
  onToggleOrder,
  onToggleAll,
  captureState,
  onPrintAllPages,
  onPrintCurrentPage,
  onDownload,
}: PrintLabelOptionsProps) {
  const template = getTemplate(options.templateId);
  const allSelected = orders.length > 0 && options.selectedOrderIds.size === orders.length;
  const busy = captureState.phase === "capturing";
  const actionsDisabled = busy || options.selectedOrderIds.size === 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label className="mb-1 block text-xs font-medium text-ink-500">Label template</label>
        <Select
          value={options.templateId}
          onChange={(e) => onOptionsChange({ templateId: e.target.value as LabelTemplateId })}
        >
          <optgroup label="A4 paper">
            {A4_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Sticker label printers">
            {STICKER_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
        </Select>
      </div>

      {template.orientationSwappable && (
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-500">Orientation</label>
          <div className="flex gap-1.5">
            {(["portrait", "landscape"] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => onOptionsChange({ orientation: o })}
                className={`flex-1 rounded-lg border px-3 py-1.5 text-sm capitalize transition-colors ${
                  options.orientation === o
                    ? "border-brass-400 bg-brass-50 text-brass-700"
                    : "border-ink-200 text-ink-600 hover:bg-ink-50"
                }`}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-500">Margin (mm)</label>
          <Input
            type="number"
            min={0}
            max={20}
            step={0.5}
            value={options.marginMm}
            onChange={(e) => onOptionsChange({ marginMm: Math.min(20, Math.max(0, Number(e.target.value) || 0)) })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-500">Copies</label>
          <Input
            type="number"
            min={1}
            max={20}
            value={options.copies}
            onChange={(e) => onOptionsChange({ copies: Math.min(20, Math.max(1, Math.round(Number(e.target.value) || 1))) })}
          />
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-medium text-ink-500">Print selected orders</label>
          <button
            type="button"
            onClick={onToggleAll}
            className="text-xs font-medium text-brass-600 hover:underline"
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        </div>
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-ink-200 p-2">
          {orders.map((order) => (
            <label key={order.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-ink-50">
              <Checkbox checked={options.selectedOrderIds.has(order.id)} onChange={() => onToggleOrder(order.id)} />
              <span className="min-w-0 flex-1 truncate">{order.orderNumber}</span>
              <span className="shrink-0 text-xs text-ink-400">{order.customerName}</span>
            </label>
          ))}
        </div>
      </div>

      {busy && (
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-ink-500">
            <span>
              Rendering labels… {captureState.progress.done}/{captureState.progress.total}
            </span>
            <span>{Math.round((captureState.progress.done / Math.max(1, captureState.progress.total)) * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full rounded-full bg-brass-500 transition-[width]"
              style={{ width: `${(captureState.progress.done / Math.max(1, captureState.progress.total)) * 100}%` }}
            />
          </div>
          {captureState.progress.total > 100 && (
            <p className="mt-1 text-[11px] text-ink-400">Large batch — this will take a bit.</p>
          )}
        </div>
      )}

      {captureState.phase === "error" && <p className="text-xs text-danger-600">{captureState.message}</p>}

      <div className="flex flex-col gap-2 border-t border-ink-100 pt-4">
        <Button variant="brass" size="sm" disabled={actionsDisabled} onClick={onPrintAllPages}>
          <Printer size={14} /> Print all pages
        </Button>
        <Button variant="outline" size="sm" disabled={actionsDisabled} onClick={onPrintCurrentPage}>
          <FileText size={14} /> Print current page only
        </Button>
        <Button variant="outline" size="sm" disabled={actionsDisabled} onClick={onDownload}>
          <Download size={14} /> Download PDF
        </Button>
      </div>
    </div>
  );
}
