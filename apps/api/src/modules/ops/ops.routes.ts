import { Router } from "express";
import { requireAdmin } from "../../middlewares/require-admin";
import { asyncHandler } from "../../lib/async-handler";
import { reliabilityReport } from "./ops.service";

/** Phase 9: GET /api/v1/ops/reliability — what is stuck, failed or inconsistent (read-only). */
export const opsRouter = Router();
opsRouter.use(requireAdmin);
opsRouter.get(
  "/reliability",
  asyncHandler(async (_req, res) => {
    res.json(await reliabilityReport());
  }),
);
