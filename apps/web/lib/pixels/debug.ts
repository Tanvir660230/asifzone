/** Console trace of every ad-pixel decision (sent, suppressed as a repeat, skipped) — on in development, silent in
 * production unless opted into per browser with `localStorage.setItem("pixels:debug", "1")` (DevTools console), which
 * is how to watch live traffic without shipping logs to every shopper. */
function enabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  try {
    return window.localStorage.getItem("pixels:debug") === "1";
  } catch {
    return false;
  }
}

export function pixelDebug(message: string, detail?: unknown): void {
  if (!enabled()) return;
  if (detail === undefined) console.info(`[pixels] ${message}`);
  else console.info(`[pixels] ${message}`, detail);
}
