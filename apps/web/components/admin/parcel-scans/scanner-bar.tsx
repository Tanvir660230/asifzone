"use client";

import Link from "next/link";
import { CloudOff, PackageCheck, PackageOpen, Volume2, VolumeX } from "lucide-react";
import type { ParcelScanKind } from "@clothing-brand/shared";
import { cn } from "@/lib/utils";

/**
 * The scanner's status strip, the same in both modes: which mode this station is in (the two modes are two pages, so a
 * refresh or a bookmark keeps the mode), whether the scanner can type into the scan box right now, the last code read,
 * and the sound switch.
 */
export function ScannerBar({
  mode,
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
  const modes = [
    { kind: "DISPATCH" as const, label: "Dispatch", href: "/admin/orders/dispatch", icon: PackageCheck },
    { kind: "RETURN" as const, label: "Returns in", href: "/admin/orders/returns-in", icon: PackageOpen },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="scanner-bar">
      <nav aria-label="Scanner mode" className="flex rounded-[var(--chip-radius)] border border-line-subtle bg-ink-900/[0.035] p-1">
        {modes.map((m) => {
          const active = m.kind === mode;
          const Icon = m.icon;
          return (
            <Link
              key={m.kind}
              href={m.href}
              aria-current={active ? "page" : undefined}
              data-testid={`scanner-mode-${m.kind.toLowerCase()}`}
              className={cn(
                "flex min-h-[40px] items-center gap-1.5 rounded-[calc(var(--chip-radius)-4px)] px-3.5 text-sm font-medium transition-colors duration-fast ease-smooth",
                active ? "bg-surface text-fg shadow-sm ring-1 ring-line-subtle" : "text-fg-muted hover:text-fg",
              )}
            >
              <Icon size={16} aria-hidden="true" />
              {m.label}
            </Link>
          );
        })}
      </nav>

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
