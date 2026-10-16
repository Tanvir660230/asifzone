/** Fire-and-forget JSON POST that survives the page unloading: navigator.sendBeacon when the browser has it, fetch with
 * `keepalive` otherwise. Carries no credentials and no CSRF header, so only public beacon endpoints may receive it.
 * Never throws. */
export function sendBeaconJson(url: string, payload: unknown): void {
  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      return;
    }
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    // a beacon must never break the page that sends it
  }
}
