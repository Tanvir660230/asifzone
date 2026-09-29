import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requireAdmin, requireRole } from "../../middlewares/require-admin";
import { readModelDrift, rebuildAllReadModels } from "../../domain/storefront/read-model.service";

/** Reconciliation for the Storefront Read Model (docs/STOREFRONT_READ_MODEL.md §5): a read-only drift report (stored
 * projection vs. a fresh computation from the canonical pricing engine) and an OWNER-only full rebuild. */
export const storefrontReadModelRouter = Router();

storefrontReadModelRouter.get(
  "/drift",
  requireAdmin,
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ drift: await readModelDrift() });
  }),
);

storefrontReadModelRouter.post(
  "/rebuild",
  requireAdmin,
  requireRole("OWNER"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ rebuilt: await rebuildAllReadModels() });
  }),
);
