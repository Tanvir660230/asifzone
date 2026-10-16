"use client";

import { AlertTriangle, CheckCircle2, Download, FileText, Printer, Ruler } from "lucide-react";
import type { Order } from "@clothing-brand/shared";
import { LABEL_TEMPLATES, getTemplate, type LabelTemplateId } from "@/lib/label-templates";
import type { CaptureProgress } from "@/lib/label-progress";
import { MAX_OFFSET_MM, PRINTER_DPIS, type PrinterDpi } from "@/lib/label-print-prefs";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

export interface PrintOptions {
  templateId: LabelTemplateId;
  orientation: "portrait" | "landscape";
  marginMm: number;
  copies: number;
  thermal: boolean;
  printerDpi: PrinterDpi;
  offsetXmm: number;
  offsetYmm: number;
  selectedOrderIds: Set<string>;
}

/** How the layout engine fared on this batch (see gradeFit in lib/label-fit.ts). */
export interface FitReport {
  full: number;
  /** Fit by showing fewer item lines / dropping the QR or info table — everything the courier needs is still there. */
  shortened: Order[];
  /** Doesn't fit even at the smallest legible text — would print cut. */
  overflow: Order[];
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
  onPrintTestPage: () => void;
  fitReport: FitReport | null;
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
  onPrintTestPage,
  fitReport,
}: PrintLabelOptionsProps) {
  const template = getTemplate(options.templateId);
  const allSelected = orders.length > 0 && options.selectedOrderIds.size === orders.length;
  const busy = captureState.phase === "capturing";
  const actionsDisabled = busy || options.selectedOrderIds.size === 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label htmlFor="label-template" className="mb-1 block text-xs font-medium text-ink-500">Label template</label>
        <Select
          id="label-template"
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

      {template.kind === "sticker" && <PrinterSettings options={options} onOptionsChange={onOptionsChange} onPrintTestPage={onPrintTestPage} />}

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

      {captureState.phase === "ready" && fitReport && <FitSummary report={fitReport} />}

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

/** Thermal mode, printer resolution, and the position nudge the test page measures. Sticker templates only — an A4
 * sheet goes through an ordinary printer that handles greys and has its own margins. */
function PrinterSettings({ options, onOptionsChange, onPrintTestPage }: Pick<PrintLabelOptionsProps, "options" | "onOptionsChange" | "onPrintTestPage">) {
  const clampOffset = (v: string) => Math.round(Math.min(MAX_OFFSET_MM, Math.max(-MAX_OFFSET_MM, Number(v) || 0)) * 2) / 2;
  return (
    <fieldset className="space-y-3 rounded-lg border border-ink-200 p-3">
      <legend className="px-1 text-xs font-medium text-ink-500">Sticker printer</legend>
      <label className="flex items-start gap-2 text-sm text-ink-700">
        <Checkbox checked={options.thermal} onChange={(e) => onOptionsChange({ thermal: e.target.checked })} />
        <span>
          Thermal printer
          <span className="block text-xs text-ink-500">Sharp black and white, no grey dots. Turn off for a colour or inkjet printer.</span>
        </span>
      </label>
      {options.thermal && (
        <div>
          <label htmlFor="printer-dpi" className="mb-1 block text-xs font-medium text-ink-500">
            Printer resolution
          </label>
          <Select id="printer-dpi" value={String(options.printerDpi)} onChange={(e) => onOptionsChange({ printerDpi: Number(e.target.value) as PrinterDpi })}>
            {PRINTER_DPIS.map((dpi) => (
              <option key={dpi} value={dpi}>
                {dpi} dpi{dpi === 203 ? " (most printers)" : ""}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="offset-x" className="mb-1 block text-xs font-medium text-ink-500">
            Move right (mm)
          </label>
          <Input id="offset-x" type="number" min={-MAX_OFFSET_MM} max={MAX_OFFSET_MM} step={0.5} value={options.offsetXmm} onChange={(e) => onOptionsChange({ offsetXmm: clampOffset(e.target.value) })} />
        </div>
        <div>
          <label htmlFor="offset-y" className="mb-1 block text-xs font-medium text-ink-500">
            Move down (mm)
          </label>
          <Input id="offset-y" type="number" min={-MAX_OFFSET_MM} max={MAX_OFFSET_MM} step={0.5} value={options.offsetYmm} onChange={(e) => onOptionsChange({ offsetYmm: clampOffset(e.target.value) })} />
        </div>
      </div>
      <Button variant="outline" size="sm" className="w-full" onClick={onPrintTestPage}>
        <Ruler size={14} /> Print a test sticker
      </Button>
      <p className="text-xs leading-relaxed text-ink-500">
        All four edges of the test frame should print. If one side is missing, set the printer&apos;s paper size to this template&apos;s size;
        if the frame is shifted, read the shift off the ruler and enter it above (negative moves left / up).
      </p>
    </fieldset>
  );
}

function FitSummary({ report }: { report: FitReport }) {
  const total = report.full + report.shortened.length + report.overflow.length;
  return (
    <div className="space-y-2 rounded-lg border border-ink-200 p-3 text-xs" data-testid="label-fit-report">
      {report.overflow.length === 0 && report.shortened.length === 0 && (
        <p className="flex items-center gap-1.5 text-success-700">
          <CheckCircle2 size={14} /> All {total} label{total === 1 ? "" : "s"} fit in full.
        </p>
      )}
      {report.shortened.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 font-medium text-ink-700">
            <CheckCircle2 size={14} className="text-success-700" /> {report.shortened.length} label{report.shortened.length === 1 ? "" : "s"} fit with a shorter item list
          </p>
          <p className="mt-0.5 text-ink-500">Name, phone, full address, COD and the courier note are all there. {orderList(report.shortened)}</p>
        </div>
      )}
      {report.overflow.length > 0 && (
        <div className="text-danger-600">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle size={14} /> {report.overflow.length} label{report.overflow.length === 1 ? "" : "s"} too long for this size
          </p>
          <p className="mt-0.5">{orderList(report.overflow)} — pick a bigger label size, or shorten the address on the order.</p>
        </div>
      )}
    </div>
  );
}

function orderList(orders: Order[]): string {
  const shown = orders.slice(0, 4).map((o) => o.orderNumber);
  return orders.length > 4 ? `${shown.join(", ")} +${orders.length - 4} more` : shown.join(", ");
}
