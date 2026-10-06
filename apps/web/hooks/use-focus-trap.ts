"use client";

import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import { pushLayer } from "@/lib/layer-stack";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface UseFocusTrapOptions {
  /** Whether the trap is active — pass the same open/expanded flag that drives the overlay's visibility. */
  active: boolean;
  onEscape: () => void;
  /** Locks page scroll for as long as the trap is active. Default true — every full-screen or
   * off-canvas overlay in the app wants this; opt out only for something that doesn't cover the
   * page (there's currently no such case, but the option exists rather than assuming). */
  lockScroll?: boolean;
  /** Receives this overlay's layer id while open (null when closed) — for key handling that belongs to the top layer
   * only (lib/layer-stack.ts `isTopLayer`). */
  layerRef?: MutableRefObject<number | null>;
}

/** The Tab-cycle / Escape-to-close / focus-restore-on-close recipe every modal-like overlay in the
 * app needs. This used to be hand-copied into Modal, Drawer, CartDrawer, and FacetFilters
 * independently (a fix to one wouldn't reach the others), and was missing entirely from MobileNav,
 * SearchOverlay, and the product gallery lightbox — each of those let a keyboard user Tab out into
 * the page behind the overlay. One hook now backs all of them.
 *
 * Escape goes through the layer stack (lib/layer-stack.ts): with a popover open over a drawer, Escape closes only the
 * popover.
 *
 * Returns a ref to attach to the overlay's outermost focusable container. */
export function useFocusTrap<T extends HTMLElement>({
  active,
  onEscape,
  lockScroll = true,
  layerRef,
}: UseFocusTrapOptions): RefObject<T | null> {
  const panelRef = useRef<T>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  // Registered once per open (not per render), so a re-rendering parent can't push this layer back over a newer one.
  useEffect(() => {
    if (!active) return;
    const layer = pushLayer(() => onEscapeRef.current());
    if (layerRef) layerRef.current = layer.id;
    return () => {
      layer.pop();
      if (layerRef) layerRef.current = null;
    };
  }, [active, layerRef]);

  useEffect(() => {
    if (!active) return;

    // Remember what had focus before opening, so it can be restored once this closes.
    triggerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];
    (focusable[0] ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !panel) return;

      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    if (lockScroll) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (lockScroll) document.body.style.overflow = "";
      triggerRef.current?.focus();
    };
    // onEscape is read through a ref: a parent's fresh closure must not re-run this setup (which would steal focus back
    // to the first field on every parent render).
  }, [active, lockScroll]);

  return panelRef;
}
