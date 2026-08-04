/** e.g. ORD-20260804-4F2A — date-prefixed for readability, random suffix to avoid a DB round trip for uniqueness. */
export function generateOrderNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ORD-${date}-${suffix}`;
}
