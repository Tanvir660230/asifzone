import { prisma } from "../../config/prisma";
import type { CapturedError, ErrorReporter } from "./error-capture";
import { errorSource, fingerprintError } from "./error-fingerprint";
import { logger, maskText } from "./logger";

/**
 * Keeps production failures where the owner can see them (Admin › System health › Errors): every captured error is
 * grouped by fingerprint into an `ErrorGroup` row with a running count.
 *
 * `report` only touches memory — a failing request never waits on, or fails because of, this. A timer flushes the
 * buffer with one upsert per group, so an error storm costs one write per kind of error per interval. A failed flush
 * drops its batch and logs a warning; it never calls captureError (that would feed the storm back into itself).
 */

interface Pending {
  count: number;
  latest: CapturedError;
}

const TITLE_MAX = 200;
const PATH_MAX = 300;

/** Network errors (an AggregateError from a refused connection) often carry no message — the code is what says what
 * happened, then the first inner error's message. */
function messageOf(err: Error): string {
  if (err.message) return err.message;
  const code = (err as { code?: unknown }).code;
  const inner = err instanceof AggregateError ? (err.errors[0] as { message?: unknown } | undefined)?.message : undefined;
  return [typeof code === "string" ? code : null, typeof inner === "string" ? inner : null].filter(Boolean).join(" — ") || "(no message)";
}

function titleOf(c: CapturedError): string {
  const err = c.error instanceof Error ? c.error : null;
  const text = err ? `${err.name}: ${messageOf(err)}` : `Thrown ${typeof c.error}: ${String(c.error)}`;
  return maskText(text).slice(0, TITLE_MAX);
}

function stackOf(c: CapturedError): string | null {
  const stack = c.error instanceof Error ? c.error.stack : undefined;
  return stack ? maskText(stack.split("\n").slice(0, 8).join("\n")) : null;
}

/** What finds this occurrence in the logs: the request's correlation id — or, for a website crash from a server render,
 * Next.js's digest (the web server logs the real error under it; the beacon request's own id would lead nowhere). */
function supportCodeOf(c: CapturedError): string | null {
  const digest = c.context?.digest;
  if (typeof digest === "string" && /^[\w-]{1,64}$/.test(digest)) return `digest ${digest}`;
  return c.correlationId;
}

function pathOf(c: CapturedError): string | null {
  const queue = typeof c.context?.queue === "string" ? `Background job: ${c.context.queue}` : undefined;
  const raw = c.context?.route ?? c.context?.path ?? queue ?? c.operation;
  if (typeof raw !== "string" || !raw) return null;
  return maskText(raw.split(/[?#]/)[0]!).slice(0, PATH_MAX);
}

export function createErrorStoreReporter(opts: { flushIntervalMs?: number; maxGroups?: number } = {}) {
  const flushIntervalMs = opts.flushIntervalMs ?? 5000;
  const maxGroups = opts.maxGroups ?? 200;
  let pending = new Map<string, Pending>();
  // Writes run one batch at a time, in order; every flush() waits for all of them, so a shutdown or crash flush
  // never returns while an earlier timer flush is still writing.
  let writes: Promise<void> = Promise.resolve();

  const report: ErrorReporter = (captured) => {
    const fingerprint = fingerprintError(captured);
    const entry = pending.get(fingerprint);
    if (entry) {
      entry.count += 1;
      entry.latest = captured;
    } else if (pending.size < maxGroups) {
      pending.set(fingerprint, { count: 1, latest: captured });
    }
  };

  /** One upsert per group; a group that fails to save is skipped, the rest are still written. */
  async function write(batch: Map<string, Pending>): Promise<void> {
    const now = new Date();
    let failed = 0;
    let lastFailure = "";
    for (const [fingerprint, { count, latest }] of batch) {
      const fields = {
        errorClass: latest.errorClass,
        title: titleOf(latest),
        sampleStack: stackOf(latest),
        lastPath: pathOf(latest),
        lastCorrelationId: supportCodeOf(latest),
        lastSeenAt: now,
      };
      try {
        await prisma.errorGroup.upsert({
          where: { fingerprint },
          create: { fingerprint, source: errorSource(latest), count, ...fields },
          update: { count: { increment: count }, resolvedAt: null, ...fields },
        });
      } catch (err) {
        failed += 1;
        lastFailure = err instanceof Error ? err.message : String(err);
      }
    }
    if (failed) logger.warn(`[error-store] could not save ${failed} of ${batch.size} error group(s); those are dropped`, { detail: lastFailure });
  }

  async function flush(): Promise<void> {
    if (pending.size > 0) {
      const batch = pending;
      pending = new Map();
      writes = writes.then(() => write(batch));
    }
    await writes;
  }

  const timer = setInterval(() => void flush(), flushIntervalMs);
  timer.unref();

  return {
    report,
    flush,
    stop() {
      clearInterval(timer);
    },
  };
}
