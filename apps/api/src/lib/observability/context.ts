/**
 * Request / job context (Phase 11, BD-11.4; contract §6.1). An AsyncLocalStorage carries `{ correlationId, operation }` through
 * the whole async chain of an HTTP request or a background job, so the logger and error capture pick it up without any
 * function signature changing. Observability only — never read by business logic, never persisted except as
 * `OutboxEvent.correlationId`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

export interface ObservabilityContext {
  correlationId: string;
  /** e.g. "POST /api/orders/" or "outbox:deliver" */
  operation: string;
}

const storage = new AsyncLocalStorage<ObservabilityContext>();

/** Client-supplied IDs are accepted only in this shape — no free text, nothing that could carry PII or log-injection. */
const VALID_CORRELATION_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function newCorrelationId(): string {
  return crypto.randomUUID();
}

export function acceptCorrelationId(candidate: unknown): string {
  return typeof candidate === "string" && VALID_CORRELATION_ID.test(candidate) ? candidate : newCorrelationId();
}

export function runWithContext<T>(ctx: ObservabilityContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentContext(): ObservabilityContext | undefined {
  return storage.getStore();
}

export function currentCorrelationId(): string | null {
  return storage.getStore()?.correlationId ?? null;
}
