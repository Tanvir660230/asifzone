"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, ScanLine, XCircle } from "lucide-react";
import type { PackScanResponse, ParcelScanResult } from "@clothing-brand/shared";
import { Input } from "@/components/ui/input";
import { useScannerSound, type ScannerTone } from "@/components/admin/parcel-scans/scanner-sound";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import { getErrorMessage } from "@/lib/api-client";
import { orderStatusLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { invalidateOrderQueries } from "./order-domain";

type Line = PackScanResponse & { id: number; undone?: boolean };

const TONE: Record<ParcelScanResult, { sound: ScannerTone; icon: typeof CheckCircle2; className: string }> = {
  ACCEPTED: { sound: "scan", icon: CheckCircle2, className: "text-success-700" },
  ALREADY_PROCESSED: { sound: "duplicate", icon: CircleAlert, className: "text-warning-700" },
  DUPLICATE: { sound: "duplicate", icon: CircleAlert, className: "text-warning-700" },
  INVALID: { sound: "unknown", icon: XCircle, className: "text-danger-700" },
  INELIGIBLE: { sound: "invalid", icon: XCircle, className: "text-danger-700" },
};

/**
 * Pack scan, on the To pack view: a USB scanner types the label's code and Enter, and that order becomes Packed (the API
 * moves only a confirmed / processing order; everything else gets a plain answer). Focus stays in the box so the packer
 * can scan parcel after parcel; the last few answers stay listed, each packed one with an Undo.
 */
export function PackScanBar() {
  const queryClient = useQueryClient();
  const { play } = useScannerSound();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const seq = useRef(0);

  async function submit() {
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    setCode("");
    try {
      const res = await adminOrdersApi.packByScan(value);
      play(TONE[res.result].sound);
      setLines((prev) => [{ ...res, id: ++seq.current }, ...prev].slice(0, 5));
      if (res.result === "ACCEPTED") invalidateOrderQueries(queryClient, res.orderId);
    } catch (err) {
      play("failed");
      setLines((prev) => [{ id: ++seq.current, result: "INVALID" as const, message: getErrorMessage(err, "Couldn't reach the server — scan it again") }, ...prev].slice(0, 5));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function undo(line: Line) {
    if (!line.orderId || !line.previousStatus) return;
    try {
      await adminOrdersApi.bulkUpdateOrderStatus([line.orderId], line.previousStatus, "Undo: not packed yet");
      setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, undone: true } : l)));
      invalidateOrderQueries(queryClient, line.orderId);
    } catch (err) {
      setLines((prev) => [{ id: ++seq.current, result: "INVALID" as const, message: getErrorMessage(err, "Couldn't undo — change the status on the order") }, ...prev].slice(0, 5));
    } finally {
      inputRef.current?.focus();
    }
  }

  return (
    <section aria-label="Pack scan" className="mt-4 rounded-xl border border-line-subtle bg-surface px-4 py-3" data-testid="pack-scan">
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <ScanLine size={18} className="shrink-0 text-fg-muted" aria-hidden="true" />
        <label htmlFor="pack-scan-code" className="text-sm font-medium text-fg">
          Scan to pack
        </label>
        <Input
          ref={inputRef}
          id="pack-scan-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Scan the label, or type the order number and press Enter"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          className="min-w-0 flex-1 sm:max-w-md"
        />
        <p className="text-xs text-fg-subtle max-sm:w-full">Each scan marks that order Packed.</p>
      </form>
      {lines.length > 0 && (
        <ul className="mt-2.5 space-y-1" aria-live="polite">
          {lines.map((line, i) => {
            const tone = TONE[line.result];
            const Icon = tone.icon;
            return (
              <li key={line.id} className={cn("flex items-center gap-2 text-sm", i > 0 && "opacity-70")}>
                <Icon size={15} className={cn("shrink-0", tone.className)} aria-hidden="true" />
                <span className={cn("min-w-0 flex-1 truncate", line.undone ? "text-fg-subtle line-through" : "text-fg")}>{line.message}</span>
                {line.result === "ACCEPTED" && line.previousStatus && !line.undone && (
                  <button type="button" onClick={() => void undo(line)} className="shrink-0 rounded-md px-2 py-0.5 text-sm font-semibold text-accent hover:bg-accent/10">
                    Undo
                  </button>
                )}
                {line.undone && line.previousStatus && <span className="shrink-0 text-xs text-fg-subtle">back in {orderStatusLabel(line.previousStatus)}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
