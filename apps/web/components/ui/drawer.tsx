"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { IconButton } from "./icon-button";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  widthClassName?: string;
  /** Optional prev/next through whatever list this drawer's content was opened from (e.g. the
   * Orders table) — nav chrome only renders when at least one of these is passed, so consumers
   * that don't need it (Customers) are visually unaffected. */
  onPrev?: () => void;
  onNext?: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  /** e.g. "3 of 20" — shown next to the nav buttons on sm and up. */
  navLabel?: string;
  /** What the prev/next buttons step through, for their accessible names ("Previous order"). */
  navItemLabel?: string;
}

function isTypingTarget(el: EventTarget | null): boolean {
  const tag = (el as HTMLElement | null)?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean((el as HTMLElement | null)?.isContentEditable);
}

/** Right-side slide-in panel (full width on mobile) — portal, backdrop-click and Escape to close,
 * focus trap, optional prev/next stepping (Arrow Up/Down) through the list it was opened from. */
export function Drawer({
  open,
  onClose,
  title,
  children,
  widthClassName = "max-w-xl",
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
  navLabel,
  navItemLabel = "item",
}: DrawerProps) {
  const panelRef = useFocusTrap<HTMLDivElement>({ active: open, onEscape: onClose });

  // Kept as its own effect, separate from the focus-trap hook above — onPrev/onNext are fresh
  // closures every render of the parent (e.g. the Orders list), and folding this into the trap's
  // effect would re-run its setup (stealing focus back to the first field) on every one of those
  // re-renders, not just when the drawer actually opens.
  const navRef = useRef({ onPrev, onNext, prevDisabled, nextDisabled });
  useEffect(() => {
    navRef.current = { onPrev, onNext, prevDisabled, nextDisabled };
  });

  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !isTypingTarget(document.activeElement)) {
        const nav = navRef.current;
        if (e.key === "ArrowUp" && nav.onPrev && !nav.prevDisabled) nav.onPrev();
        if (e.key === "ArrowDown" && nav.onNext && !nav.nextDisabled) nav.onNext();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="ui-overlay fixed inset-0 z-overlay animate-fade-in" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "ml-auto flex h-full w-full flex-col border-l border-white/70 bg-surface shadow-glass-lg animate-slide-in-right",
          widthClassName,
        )}
      >
        <div className="glass sticky top-0 z-raised flex shrink-0 items-center gap-3 border-b border-line-subtle px-5 py-3.5">
          <div className="min-w-0 flex-1 truncate font-display text-lg tracking-tight text-fg">{title}</div>
          {(onPrev || onNext) && (
            <div className="flex shrink-0 items-center gap-1">
              {navLabel && <span className="hidden text-xs tabular-nums text-fg-subtle sm:inline">{navLabel}</span>}
              <IconButton size="sm" onClick={onPrev} disabled={!onPrev || prevDisabled} aria-label={`Previous ${navItemLabel}`}>
                <ChevronUp size={18} />
              </IconButton>
              <IconButton size="sm" onClick={onNext} disabled={!onNext || nextDisabled} aria-label={`Next ${navItemLabel}`}>
                <ChevronDown size={18} />
              </IconButton>
            </div>
          )}
          <IconButton size="sm" onClick={onClose} aria-label="Close">
            <X size={18} />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
