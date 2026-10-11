import type { PixelLineItem } from "./types";

/** Repeat-suppression shared by every ad pixel — one decision per business event, so Meta and TikTok can never disagree
 * about whether something happened twice. */

// Same key within this window = the same moment firing twice (React Strict Mode's dev-only double effect run, a
// remount), not a second genuine view — a real revisit is always further apart.
const REPEAT_WINDOW_MS = 2000;
const lastFiredAt = new Map<string, number>();

export function firedJustNow(key: string): boolean {
  const now = Date.now();
  const last = lastFiredAt.get(key);
  lastFiredAt.set(key, now);
  return last !== undefined && now - last < REPEAT_WINDOW_MS;
}

/** True the first time `key` is seen in this storage (and records it). Storage being unavailable (private mode, blocked
 * site data) fails open — the event still fires; Purchase stays protected by its deterministic event_id either way. */
export function firstTime(kind: "session" | "local", key: string): boolean {
  try {
    const storage = kind === "session" ? window.sessionStorage : window.localStorage;
    if (storage.getItem(key)) return false;
    storage.setItem(key, "1");
  } catch {
    // fall through
  }
  return true;
}

/** Stable per cart contents — "the same checkout" for the once-per-cart guards. */
export function cartSignature(items: PixelLineItem[]): string {
  return items
    .map((i) => `${i.id}x${i.quantity}`)
    .sort()
    .join(",");
}

/** A fresh id for a one-off browser event. */
export function newEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
