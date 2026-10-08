"use client";

import { useEffect } from "react";

// How much of the layout viewport the visual viewport must lose before it counts as the on-screen keyboard rather than
// browser chrome sliding in and out.
const KEYBOARD_MIN_PX = 150;

/**
 * Blueprint V2 §X: on phones, sticky bars (tab bar, action bars) hide while the on-screen keyboard is open so the field
 * being typed into stays visible. Sets `data-keyboard="open"` on <html> while the visual viewport is squeezed by the
 * keyboard; CSS hides every `[data-hide-on-keyboard]` element then (globals.css). Mounted once, by the admin shell.
 */
export function useKeyboardFlag() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const update = () => {
      const open = window.innerHeight - viewport.height > KEYBOARD_MIN_PX;
      if (open) root.dataset.keyboard = "open";
      else delete root.dataset.keyboard;
    };
    viewport.addEventListener("resize", update);
    update();
    return () => {
      viewport.removeEventListener("resize", update);
      delete root.dataset.keyboard;
    };
  }, []);
}
