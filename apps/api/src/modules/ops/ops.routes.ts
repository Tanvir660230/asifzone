import { Router } from "express";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { asyncHandler } from "../../lib/async-handler";
import { reliabilityReport } from "./ops.service";
import { providerStatus } from "../../providers/registry";

/** Phase 9: GET /api/v1/ops/reliability — what is stuck, failed or inconsistent (read-only). */
export const opsRouter = Router();
opsRouter.use(requireAdmin);
opsRouter.get(
  "/reliability", requirePermission("ops.read"),
  asyncHandler(async (_req, res) => {
    res.json(await reliabilityReport());
  }),
);

/** Phase 12 (D-4): GET /api/v1/ops/providers — which provider backs each capability and whether its credentials are
 * present. Booleans and provider names only, never a value. OWNER-only (settings.manage), like the provider config. */
opsRouter.get(
  "/providers", requirePermission("settings.manage"),
  asyncHandler(async (_req, res) => {
    res.json({ providers: providerStatus() });
  }),
);
