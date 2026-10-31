/** `<input type="datetime-local">` needs "YYYY-MM-DDTHH:mm", interpreted (both on display and on
 * submit) in the browser's local time — matching how an admin actually thinks about "visible from
 * 9am", not UTC. */
export function toDatetimeLocalValue(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Today as "YYYY-MM-DD" in the browser's local time, for `<input type="date">` defaults. `toISOString()` gives the
 * UTC date, which in Dhaka is still yesterday until 6am — an expense recorded at 1am then falls outside "today". */
export function todayLocal(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** Shared by the Homepage Builder's section list and the Banners page — both rows carry a plain
 * `startsAt`/`endsAt` schedule window with identical Scheduled/Expired semantics. */
export function scheduleStatus(row: { startsAt: string | null; endsAt: string | null }): { label: string; className: string } | null {
  const now = Date.now();
  if (row.startsAt && new Date(row.startsAt).getTime() > now) {
    return { label: "Scheduled", className: "bg-info-100 text-info-700" };
  }
  if (row.endsAt && new Date(row.endsAt).getTime() < now) {
    return { label: "Expired", className: "bg-ink-200 text-ink-700" };
  }
  return null;
}
