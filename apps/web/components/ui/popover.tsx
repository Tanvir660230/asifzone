"use client";

import { useCallback, useEffect, useLayoutEffect, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
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
  /** "menu" when the panel is a list of actions: its `menuitem`s get arrow-key, Home and End navigation (WAI-ARIA menu
   * pattern). Anything else — fields, pickers — stays a "dialog". */
  role?: "dialog" | "menu";
  "aria-label"?: string;
  children: ReactNode;
}

const MENU_ITEM = '[role="menuitem"]:not(:disabled)';

/** Arrow keys move between a menu's items, wrapping at the ends; Tab still leaves through the focus trap. */
function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEM));
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === "ArrowDown" ? (at + 1) % items.length
    : e.key === "ArrowUp" ? (at <= 0 ? items.length - 1 : at - 1)
    : e.key === "Home" ? 0
    : e.key === "End" ? items.length - 1
    : -1;
  if (next === -1) return;
  e.preventDefault();
  items[next]!.focus();
}

/** Lightweight anchored popover — portal + outside-click + Escape/Tab-trap (via the same
 * `useFocusTrap` hook Modal/Drawer use, with `lockScroll: false` since a popover shouldn't freeze
 * the page behind it), positioned in `fixed` coordinates off the anchor's own rect rather than a
 * third-party positioning library. Used for "More filters", row/bulk context menus, and the order
 * status picker. */
export function Popover({ open, onClose, anchorRef, align = "start", className, role = "dialog", "aria-label": ariaLabel, children }: PopoverProps) {
  const panelRef = useFocusTrap<HTMLDivElement>({ active: open, onEscape: onClose, lockScroll: false });
  const [style, setStyle] = useState<{ top: number; left: number } | null>(null);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const panelWidth = panel?.offsetWidth ?? 280;
    const rawLeft = align === "end" ? rect.right - panelWidth : rect.left;
    const left = Math.min(Math.max(8, rawLeft), window.innerWidth - panelWidth - 8);
    // Below the anchor when it fits; otherwise above it (a row menu near the bottom of the screen); otherwise as low as
    // fits — never past the viewport edge, where its items couldn't be reached.
    const panelHeight = panel?.offsetHeight ?? 0;
    const below = rect.bottom + 8;
    const above = rect.top - 8 - panelHeight;
    const fitsBelow = below + panelHeight <= window.innerHeight - 8;
    const top = fitsBelow || above < 8 ? Math.max(8, Math.min(below, window.innerHeight - panelHeight - 8)) : above;
    setStyle({ top, left });
    // panelRef is a stable ref object from useFocusTrap; not a reactive dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [align, anchorRef]);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }

    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  // Re-measure when the panel's own content resizes (e.g. a picker expanding to show a calendar) —
  // the effect above only fires on open/align/anchor changes, so without this a panel that grows
  // after its initial position is set can silently overflow off the edge of the viewport.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const ro = new ResizeObserver(() => reposition());
    ro.observe(panel);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
      role={role}
      aria-label={ariaLabel}
      tabIndex={-1}
      onKeyDown={role === "menu" ? onMenuKeyDown : undefined}
      style={{ position: "fixed", top: style?.top ?? -9999, left: style?.left ?? -9999 }}
      className={cn(
        "ui-floating z-overlay max-h-[70vh] overflow-y-auto animate-pop-in",
        className,
      )}
      // Popovers routinely open on top of a Drawer/Modal: Escape closes only this one, the top layer of the overlay
      // stack (useFocusTrap → lib/layer-stack.ts), so no per-component stopPropagation is needed.
    >
      {children}
    </div>,
    document.body,
  );
}
