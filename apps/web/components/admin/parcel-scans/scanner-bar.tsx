"use client";

import { CloudOff, Volume2, VolumeX } from "lucide-react";
import type { ParcelScanKind } from "@clothing-brand/shared";
import { cn } from "@/lib/utils";

/**
 * The scanner's status strip, the same in both modes: whether the scanner can type into the scan box right now, the last
 * code read, and the sound switch. The mode (Dispatch scan / Returns in) is the page, chosen in the Orders tabs above —
 * a second switch here made three rows of navigation on a phone.
 */
export function ScannerBar({
  ready,
  online,
  lastCode,
  sound,
  onSound,
}: {
  mode: ParcelScanKind;
  ready: boolean;
  online: boolean;
  lastCode: string | null;
  sound: boolean;
  onSound: (on: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="scanner-bar">
      <span
        className={cn("flex items-center gap-1.5 text-xs font-medium", !online ? "text-info-800" : ready ? "text-success-700" : "text-warning-800")}
        data-testid="scanner-ready"
        data-ready={ready && online ? "true" : "false"}
      >
        {!online ? (
          <>
            <CloudOff size={13} aria-hidden="true" /> Offline
          </>
        ) : (
          <>
            <span className={cn("h-2 w-2 rounded-full", ready ? "bg-success-500" : "bg-warning-500")} aria-hidden="true" />
            {ready ? "Scanner ready" : "Tap the scan box to scan"}
          </>
        )}
      </span>

      {lastCode && (
        <span className="min-w-0 max-w-full truncate text-xs text-fg-muted" title={lastCode}>
          Last: <span className="font-mono text-fg">{lastCode.length > 40 ? `${lastCode.slice(0, 40)}…` : lastCode}</span>
        </span>
      )}

      <button
        type="button"
        onClick={() => onSound(!sound)}
        aria-pressed={sound}
        className="ml-auto flex min-h-[40px] items-center gap-1.5 rounded-full px-3 text-xs font-medium text-fg-muted ring-1 ring-line-subtle hover:text-fg"
        data-testid="scanner-sound"
      >
        {sound ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}
        Sound {sound ? "on" : "off"}
      </button>
    </div>
  );
}
