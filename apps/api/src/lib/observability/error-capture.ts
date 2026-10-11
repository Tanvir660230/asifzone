/**
 * Provider-neutral error capture (Phase 11, BD-11.4; contract §6.3). Call sites — the HTTP error handler (5xx only), every
 * BullMQ worker failure, outbox consumer failures, scheduled jobs and fire-and-forget paths — call `captureError`. The
 * default reporter writes a structured `error` log line; a hosted or self-hosted tracker can be attached later with
 * `registerErrorReporter` (from server.ts, behind env). No vendor SDK lives here.
 *
 * Never business truth: returns void, never throws, never writes to the database.
 */
import { currentContext } from "./context";
import { classifyError, logger, maskText, type ErrorClass } from "./logger";

export interface CapturedError {
  error: unknown;
  errorClass: ErrorClass;
  correlationId: string | null;
  operation: string | null;
  context?: Record<string, unknown>;
}

export type ErrorReporter = (captured: CapturedError) => void;

const reporters: ErrorReporter[] = [];

export function registerErrorReporter(reporter: ErrorReporter): () => void {
  reporters.push(reporter);
  return () => {
    const i = reporters.indexOf(reporter);
    if (i >= 0) reporters.splice(i, 1);
  };
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  try {
    const ctx = currentContext();
    const captured: CapturedError = { error, errorClass: classifyError(error), correlationId: ctx?.correlationId ?? null, operation: ctx?.operation ?? null, context };
    const err = error instanceof Error ? error : null;
    logger.error(err ? maskText(err.message) : "non-error thrown", {
      errorClass: captured.errorClass,
      errorName: err?.name ?? typeof error,
      stack: err?.stack ? maskText(err.stack.split("\n").slice(0, 8).join("\n")) : undefined,
      ...context,
    });
    for (const report of reporters) {
      try {
        report(captured);
      } catch {
        // a broken reporter must never affect the caller
      }
    }
  } catch {
    // capture never throws
  }
}
