/**
 * Reliability attention signals (Phase 11, contract §6.5) — the Phase 9 reliability report reduced to machine-checkable counts
 * and booleans. Same detectors, one code path, nothing new calculated and nothing stored; no ids, names or amounts.
 */
import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env";
import { constantTimeEqual } from "../../lib/token-hash";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { reliabilityReport } from "./ops.service";

const OLD_UNDELIVERED_SECONDS = 15 * 60;

export async function attentionSignals(now: Date = new Date()) {
  const { generatedAt, sections } = await reliabilityReport(now);
  const signals = {
    outboxFailed: sections.outbox.failed,
    outboxUndeliveredOld: sections.outbox.oldestUndelivered && sections.outbox.oldestUndelivered.ageSeconds >= OLD_UNDELIVERED_SECONDS ? 1 : 0,
    dispatcherUnhealthy: sections.outbox.dispatcherHealthy ? 0 : 1,
    stuckCampaigns: sections.stuckCampaigns.count,
    courierOutcomeUnknown: sections.courierBookings.outcomeUnknown,
    paymentLedgerDrift: sections.paymentLedgerDrift.count,
    ledgerViolations: sections.paymentLedgerDrift.violations,
    stockDrift: sections.stockDrift.count,
    loyaltyDrift: sections.loyaltyDrift.count,
    readModelDrift: sections.readModelDrift.count,
  };
  const needsAttention = Object.values(signals).reduce((a, b) => a + b, 0);
  return { generatedAt, needsAttention, signals };
}

/**
 * Two callers, one counts-only response: an external monitor presenting `Authorization: Bearer <OPS_MONITOR_TOKEN>`
 * (constant-time compare; disabled when the token is unset) — an integration credential like the courier webhook token —
 * or an admin session holding the existing `ops.read` permission. Not a second permission system.
 */
export function requireOpsReadOrMonitorToken(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? "";
  if (env.opsMonitorToken && header.startsWith("Bearer ") && constantTimeEqual(header.slice("Bearer ".length), env.opsMonitorToken)) return next();
  void requireAdmin(req, res, (err?: unknown) => (err ? next(err) : requirePermission("ops.read")(req, res, next)));
}
