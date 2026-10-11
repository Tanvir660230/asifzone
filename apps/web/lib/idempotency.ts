/**
 * Client idempotency keys (Phase 9, docs/PHASE_9_AUDIT.md D-2/D-3). Money-creating requests — checkout, a manual order, a
 * refund, a manual payment — send an `Idempotency-Key` the API stores on a unique column, so a double click or a retry
 * after a timeout returns the first result instead of creating a second order/refund/payment. The database is the
 * backstop, with or without Redis.
 *
 * One key per operation scope, kept while the payload is unchanged (every retry of the same submission reuses it) and
 * replaced as soon as the payload changes or the previous submission succeeded (a deliberate second, identical action is
 * a new operation).
 */
const current = new Map<string, { payload: string; key: string }>();

function newKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function idempotencyKeyFor(scope: string, payload: unknown): string {
  const json = JSON.stringify(payload);
  const existing = current.get(scope);
  if (existing && existing.payload === json) return existing.key;
  const key = newKey();
  current.set(scope, { payload: json, key });
  return key;
}

/** Call after the operation succeeded: the next submission in this scope is a new operation. */
export function settleIdempotencyKey(scope: string): void {
  current.delete(scope);
}
