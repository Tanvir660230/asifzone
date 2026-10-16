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

function titleOf(c: CapturedError): string {
  const err = c.error instanceof Error ? c.error : null;
  const text = err ? `${err.name}: ${err.message}` : `Thrown ${typeof c.error}: ${String(c.error)}`;
  return maskText(text).slice(0, TITLE_MAX);
}

function stackOf(c: CapturedError): string | null {
  const stack = c.error instanceof Error ? c.error.stack : undefined;
  return stack ? maskText(stack.split("\n").slice(0, 8).join("\n")) : null;
}

function pathOf(c: CapturedError): string | null {
  const raw = c.context?.route ?? c.context?.path ?? c.operation;
  if (typeof raw !== "string" || !raw) return null;
  return maskText(raw.split(/[?#]/)[0]!).slice(0, PATH_MAX);
}

export function createErrorStoreReporter(opts: { flushIntervalMs?: number; maxGroups?: number } = {}) {
  const flushIntervalMs = opts.flushIntervalMs ?? 5000;
  const maxGroups = opts.maxGroups ?? 200;
  let pending = new Map<string, Pending>();
  let flushing: Promise<void> | null = null;

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

  async function write(batch: Map<string, Pending>): Promise<void> {
    const now = new Date();
    for (const [fingerprint, { count, latest }] of batch) {
      const fields = {
        errorClass: latest.errorClass,
        title: titleOf(latest),
        sampleStack: stackOf(latest),
        lastPath: pathOf(latest),
        lastCorrelationId: latest.correlationId,
        lastSeenAt: now,
      };
      await prisma.errorGroup.upsert({
        where: { fingerprint },
        create: { fingerprint, source: errorSource(latest), count, ...fields },
        update: { count: { increment: count }, resolvedAt: null, ...fields },
      });
    }
  }

  async function flush(): Promise<void> {
    if (flushing) await flushing;
    if (pending.size === 0) return;
    const batch = pending;
    pending = new Map();
    flushing = write(batch)
      .catch((err: unknown) => {
        logger.warn("[error-store] could not save errors; this batch is dropped", { detail: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        flushing = null;
      });
    await flushing;
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
