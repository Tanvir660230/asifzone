/**
 * Where "Back to Orders" goes: the Orders list exactly as the admin left it — page, filters, search, sort and size —
 * rather than a bare /admin/orders on page 1 (Order Operations plan, phase 2). The list records its URL on every change;
 * pages reached from it (Print labels, an order's full page, Create order) read it back. Per tab (sessionStorage).
 */
const KEY = "admin:orders-list-url";
const LIST_PATH = "/admin/orders";
/** Order history is the other list an order is opened from. */
const LIST_PATHS = [LIST_PATH, "/admin/orders/history"];

/** Only the Orders list (or Order history) is ever a return target — never an outside or unrelated URL from storage. */
export function safeOrdersListHref(value: string | null | undefined): string {
  if (!value) return LIST_PATH;
  if (!LIST_PATHS.some((p) => value === p || value.startsWith(`${p}?`))) return LIST_PATH;
  return value;
}

export function rememberOrdersListUrl(pathAndSearch: string) {
  try {
    sessionStorage.setItem(KEY, safeOrdersListHref(pathAndSearch));
  } catch {
    // Storage blocked (private mode): Back goes to the bare list.
  }
}

/** The list URL to return to (the drawer's `open` left out — coming back shouldn't reopen it). */
export function ordersListHref(): string {
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(KEY);
  } catch {
    stored = null;
  }
  const href = safeOrdersListHref(stored);
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.delete("open");
  const rest = params.toString();
  return rest ? `${path}?${rest}` : path!;
}
