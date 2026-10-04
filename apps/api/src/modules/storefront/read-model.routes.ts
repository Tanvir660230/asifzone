import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { readModelDrift, rebuildAllReadModels } from "../../domain/storefront/read-model.service";

/** Reconciliation for the Storefront Read Model (docs/STOREFRONT_READ_MODEL.md §5): a read-only drift report (stored
 * projection vs. a fresh computation from the canonical pricing engine) and an OWNER-only full rebuild. */
export const storefrontReadModelRouter = Router();

storefrontReadModelRouter.get(
  "/drift",
  requireAdmin,
  requirePermission("ops.read"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ drift: await readModelDrift() });
  }),
);

storefrontReadModelRouter.post(
  "/rebuild",
  requireAdmin,
  requirePermission("ops.repair"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ rebuilt: await rebuildAllReadModels() });
  }),
);
