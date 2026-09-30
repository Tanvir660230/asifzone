import { Router } from "express";
import { requireAdmin, requireRole } from "../../middlewares/require-admin";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/app-error";
import { outboxStatus, retryOutboxEvent } from "../../domain/outbox/processor";

/** Phase 8 operator visibility (docs/PHASE_8_AUDIT.md): how many side-effect intents are undelivered or failed, the oldest,
 * attempts and last error, and whether the dispatcher is running — plus a retry for a FAILED event (OWNER only). */
export const outboxRouter = Router();

outboxRouter.use(requireAdmin);
outboxRouter.get(
  "/status",
  asyncHandler(async (_req, res) => {
    res.json(await outboxStatus());
  }),
);
outboxRouter.post(
  "/:id/retry",
  requireRole("OWNER"),
  asyncHandler(async (req, res) => {
    if (!(await retryOutboxEvent(req.params.id!))) throw AppError.conflict("Only a failed outbox event can be retried");
    res.json({ retried: req.params.id });
  }),
);
