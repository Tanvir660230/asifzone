import type { NextFunction, Request, Response } from "express";
import { acceptCorrelationId, runWithContext } from "../lib/observability/context";
import { logger } from "../lib/observability/logger";

export const CORRELATION_HEADER = "X-Correlation-Id";

/**
 * Phase 11 (contract §6.1/§6.2): gives every request a correlation ID — the client's `X-Correlation-Id` when it is a safe
 * token, otherwise a new UUID — echoes it on the response and runs the rest of the chain inside its context. One structured
 * line per request on finish: method, route pattern (no query string, no body), status, duration.
 *
 * Mounted after the body/cookie parsers: AsyncLocalStorage context doesn't survive their stream callbacks.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction) {
  const correlationId = acceptCorrelationId(req.header(CORRELATION_HEADER));
  res.setHeader(CORRELATION_HEADER, correlationId);
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
    logger.info("request", {
      method: req.method,
      route,
      status: res.statusCode,
      durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
    });
  });
  runWithContext({ correlationId, operation: `${req.method} ${req.baseUrl}${req.path}` }, next);
}
