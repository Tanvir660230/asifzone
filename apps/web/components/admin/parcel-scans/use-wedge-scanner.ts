"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * A keyboard-wedge scanner (USB / Bluetooth in keyboard mode) types the code and presses Enter into whatever has focus.
 * On the receive page the operator also types into quantity, note and money fields, so a scan must never land there:
 *
 * - focus on the scan box: the box handles it (its own form submit);
 * - focus on the page or a button: the keystrokes are taken (capture phase — no admin shortcut fires) and typed into the
 *   scan box;
 * - focus in another field: a burst of at least 6 characters, each under 50 ms apart, ending in Enter is a scanner, not a
 *   person — the field gets its previous value back and the code is handed to `onScan`. Slower typing is left alone.
 * Dialogs and the camera (`paused`) are left alone.
 */
const BURST_GAP_MS = 50;
const MIN_SCAN_LENGTH = 6;

export function useWedgeScanner({
  inputRef,
  onType,
  onScan,
  paused,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  /** A character typed while focus was on the page — append it to the scan box. */
  onType: (ch: string) => void;
  /** A complete code read while focus was somewhere else. */
  onScan: (code: string) => void;
  paused: boolean;
}) {
  const handlers = useRef({ onType, onScan });
  handlers.current = { onType, onScan };

  useEffect(() => {
    if (paused) return;
    let burst = "";
    let lastAt = 0;
    let burstTarget: HTMLInputElement | HTMLTextAreaElement | null = null;
    let before = "";

    function restore(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
      // A React-controlled field only notices a value set through the native setter plus an input event.
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("[role=dialog]")) return;
      if (t === inputRef.current) return;
      const field = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") ? (t as HTMLInputElement | HTMLTextAreaElement) : null;
      const editable = field || t?.tagName === "SELECT" || t?.isContentEditable;
      const now = performance.now();

      if (!editable) {
        if (e.key === "Enter") {
          const code = inputRef.current?.value ?? "";
          if (code) {
            e.preventDefault();
            e.stopImmediatePropagation();
            handlers.current.onScan(code);
          }
        } else if (e.key.length === 1) {
          e.preventDefault();
          e.stopImmediatePropagation();
          handlers.current.onType(e.key);
          inputRef.current?.focus({ preventScroll: true });
        }
        return;
      }
      if (!field) return;

      if (e.key === "Enter") {
        const scanned = burst.length >= MIN_SCAN_LENGTH && now - lastAt < BURST_GAP_MS * 4 && burstTarget === field;
        if (scanned) {
          e.preventDefault();
          e.stopImmediatePropagation();
          restore(field, before);
          handlers.current.onScan(burst);
        }
        burst = "";
        burstTarget = null;
        return;
      }
      if (e.key.length !== 1) return;
      if (now - lastAt > BURST_GAP_MS || burstTarget !== field) {
        burst = "";
        burstTarget = field;
        before = field.value;
      }
      burst += e.key;
      lastAt = now;
    }

    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [paused, inputRef]);
}
