"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/hooks/use-focus-trap";

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  /** "start" aligns the popover's left edge to the anchor's left edge, "end" to the anchor's right
   * edge — pick whichever keeps the panel from overflowing off its side of the trigger. */
  align?: "start" | "end";
  className?: string;
  children: ReactNode;
}

/** Lightweight anchored popover — portal + outside-click + Escape/Tab-trap (via the same
 * `useFocusTrap` hook Modal/Drawer use, with `lockScroll: false` since a popover shouldn't freeze
 * the page behind it), positioned in `fixed` coordinates off the anchor's own rect rather than a
 * third-party positioning library. Used for "More filters", row/bulk context menus, and the order
 * status picker. */
export function Popover({ open, onClose, anchorRef, align = "start", className, children }: PopoverProps) {
  const panelRef = useFocusTrap<HTMLDivElement>({ active: open, onEscape: onClose, lockScroll: false });
  const [style, setStyle] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }

    function reposition() {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const panelWidth = panel?.offsetWidth ?? 280;
      const rawLeft = align === "end" ? rect.right - panelWidth : rect.left;
      const left = Math.min(Math.max(8, rawLeft), window.innerWidth - panelWidth - 8);
      const top = Math.min(rect.bottom + 8, window.innerHeight - 8);
      setStyle({ top, left });
    }

    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
    // panelRef is a stable ref object from useFocusTrap; not a reactive dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align, anchorRef]);

  // mousedown (not click) so a drag-select that ends outside the panel doesn't fire as a stray close.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      tabIndex={-1}
      style={{ position: "fixed", top: style?.top ?? -9999, left: style?.left ?? -9999 }}
      className={cn(
        "z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-ink-100 bg-cream-50 shadow-floatLg animate-modal-in",
        className,
      )}
      // Popovers routinely open on top of a Drawer/Modal, which has its own useFocusTrap Escape
      // listener on `document`. Without this, Escape bubbling from inside the popover reaches
      // *both* document listeners (this popover's and the drawer's underneath), closing both at
      // once. Stopping here, before the event reaches document, means only the topmost layer closes.
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
