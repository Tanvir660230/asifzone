/** Keyboard helpers shared by the shortcut dispatcher, the layer stack and components with their own key handling. */

/** An element that takes typed text — single-key shortcuts must not fire while one has focus. */
export function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  const tag = node?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(node?.isContentEditable);
}

/**
 * The canonical combo string for a key event: modifiers in a fixed order, then the key, lower-cased —
 * `mod+k`, `mod+enter`, `shift+?`→`?`, `arrowup`. `mod` is Ctrl on Windows/Linux and ⌘ on macOS (either counts).
 */
export function comboOf(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string {
  const key = event.key.toLowerCase();
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("mod");
  if (event.altKey) parts.push("alt");
  // Shift is part of a printable key already ("?" is shift+/) — only name it for named keys.
  if (event.shiftKey && event.key.length > 1) parts.push("shift");
  parts.push(key === " " ? "space" : key);
  return parts.join("+");
}
