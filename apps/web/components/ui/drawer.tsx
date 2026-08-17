"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/hooks/use-focus-trap";

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
}

function isTypingTarget(el: EventTarget | null): boolean {
  const tag = (el as HTMLElement | null)?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean((el as HTMLElement | null)?.isContentEditable);
}

/** Right-side slide-in panel — same portal/backdrop/focus-trap recipe as `cart-drawer.tsx`,
 * generalized with `Modal`'s title/children API so it can host arbitrary admin content. */
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
    <div className="fixed inset-0 z-50 bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "ml-auto flex h-full w-full flex-col bg-cream-50 shadow-floatLg animate-slide-in-right",
          widthClassName,
        )}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-ink-100 px-5 py-4">
          <div className="min-w-0 flex-1 truncate font-display text-lg text-ink-900">{title}</div>
          {(onPrev || onNext) && (
            <div className="flex shrink-0 items-center gap-1">
              {navLabel && <span className="hidden text-xs tabular-nums text-ink-400 sm:inline">{navLabel}</span>}
              <button
                onClick={onPrev}
                disabled={!onPrev || prevDisabled}
                aria-label="Previous order"
                className="rounded-full p-1.5 text-ink-500 transition-colors duration-150 ease-smooth hover:bg-ink-100 hover:text-ink-900 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronUp size={18} />
              </button>
              <button
                onClick={onNext}
                disabled={!onNext || nextDisabled}
                aria-label="Next order"
                className="rounded-full p-1.5 text-ink-500 transition-colors duration-150 ease-smooth hover:bg-ink-100 hover:text-ink-900 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronDown size={18} />
              </button>
            </div>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1.5 text-ink-400 transition-colors duration-150 ease-smooth hover:bg-ink-100 hover:text-ink-900"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
