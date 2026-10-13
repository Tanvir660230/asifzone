"use client";

import { type RefObject, useEffect, useRef } from "react";

const PHONE = "(max-width: 767.98px)";

/** Nearest ancestor of `node` inside `panel` that scrolls vertically, else the panel itself. */
function scrollParent(node: Element | null, panel: HTMLElement): HTMLElement {
  for (let el = node as HTMLElement | null; el && el !== panel; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1) {
      const overflow = getComputedStyle(el).overflowY;
      if (overflow === "auto" || overflow === "scroll") return el;
    }
  }
  return panel;
}

/**
 * Drag a phone sheet (`.ui-sheet`, globals.css) down to close it, as on iOS. The sheet follows the finger from its grabber
 * or header (`[data-sheet-handle]`), and from its content whenever that content is already scrolled to the top — so a
 * downward swipe first scrolls back up, then pulls the sheet. Let go past a quarter of its height, or with a flick, and
 * it slides away and `onClose` runs; otherwise it springs back. Touch only, and only below 768px where the panel is a sheet.
 */
export function useSheetDrag(panelRef: RefObject<HTMLElement | null>, onClose: () => void, active = true) {
  // The latest onClose without re-binding the listeners: callers pass a fresh closure every render, and a re-bind mid-drag
  // would drop the gesture.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const panel = panelRef.current;
    if (!active || !panel || !window.matchMedia(PHONE).matches) return;

    let startY = 0;
    let startX = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let state: "idle" | "pending" | "dragging" | "scrolling" = "idle";
    let fromHandle = false;
    let scroller: HTMLElement = panel;

    const setOffset = (y: number, animate: boolean) => {
      panel.style.transition = animate ? "transform var(--sheet-duration) var(--sheet-ease)" : "none";
      panel.style.transform = y ? `translate3d(0, ${y}px, 0)` : "";
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const target = e.target as Element;
      // Controls that move sideways or take text keep their own gestures.
      if (target.closest("input, textarea, select, [data-sheet-ignore]")) return;
      const touch = e.touches[0]!;
      startY = lastY = touch.clientY;
      startX = touch.clientX;
      lastT = e.timeStamp;
      velocity = 0;
      fromHandle = Boolean(target.closest("[data-sheet-handle], .ui-sheet-grabber"));
      scroller = scrollParent(target, panel);
      state = "pending";
    };

    const onMove = (e: TouchEvent) => {
      if (state === "idle" || state === "scrolling") return;
      const touch = e.touches[0]!;
      const dy = touch.clientY - startY;
      if (state === "pending") {
        const dx = touch.clientX - startX;
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        // Down, mostly vertical, and nothing above to scroll back to: this is the sheet's gesture.
        const pullsSheet = dy > 0 && Math.abs(dy) > Math.abs(dx) && (fromHandle || scroller.scrollTop <= 0);
        state = pullsSheet ? "dragging" : "scrolling";
        if (!pullsSheet) return;
        startY = touch.clientY;
      }
      e.preventDefault();
      const dt = Math.max(1, e.timeStamp - lastT);
      velocity = (touch.clientY - lastY) / dt;
      lastY = touch.clientY;
      lastT = e.timeStamp;
      // Upward past the resting point resists, like a rubber band.
      const offset = touch.clientY - startY;
      setOffset(offset > 0 ? offset : offset / 4, false);
    };

    const onEnd = () => {
      if (state !== "dragging") {
        state = "idle";
        return;
      }
      state = "idle";
      const offset = lastY - startY;
      const height = panel.getBoundingClientRect().height;
      if (offset > Math.min(160, height * 0.25) || velocity > 0.6) {
        setOffset(height + 24, true);
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          closeRef.current();
        };
        panel.addEventListener("transitionend", close, { once: true });
        // Belt and braces: close even if the transition never reports (reduced motion, a tab switch).
        window.setTimeout(close, 450);
      } else {
        setOffset(0, true);
      }
    };

    panel.addEventListener("touchstart", onStart, { passive: true });
    panel.addEventListener("touchmove", onMove, { passive: false });
    panel.addEventListener("touchend", onEnd);
    panel.addEventListener("touchcancel", onEnd);
    return () => {
      panel.removeEventListener("touchstart", onStart);
      panel.removeEventListener("touchmove", onMove);
      panel.removeEventListener("touchend", onEnd);
      panel.removeEventListener("touchcancel", onEnd);
      panel.style.transform = "";
      panel.style.transition = "";
    };
  }, [panelRef, active]);
}
