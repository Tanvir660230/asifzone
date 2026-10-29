import { Router } from "express";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { asyncHandler } from "../../lib/async-handler";
import { reliabilityReport } from "./ops.service";
import { capabilities, providerStatus } from "../../providers/registry";
import { z } from "zod";
import { validate } from "../../middlewares/validate";
import { recordAudit } from "../../lib/audit";
import { getErrorGroup, listErrorGroups, resolveErrorGroup } from "./errors.service";
import { summarizeVitals } from "./web-vitals.service";
import { courierHealthReport } from "../courier/courier-health.service";

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

/** Phase 12 D-4: GET /api/v1/ops/capabilities — which provider-backed actions are usable on this deployment (booleans
 * only, no provider names or credential details), so the admin UI never offers an action that can't work. ops.read —
 * held by OWNER and STAFF — like every /api/v1/ops route (Phase 10 guard). */
opsRouter.get(
  "/capabilities", requirePermission("ops.read"),
  asyncHandler(async (_req, res) => {
    res.json({ capabilities: capabilities() });
  }),
);

/** Order Operations Phase 0: GET /api/v1/ops/courier-health — is the Steadfast webhook proven healthy (each check, last 48 h
 * and the week), refused calls (reason and time only), and the courier-status poll's pace. Read-only. ops.read. */
opsRouter.get(
  "/courier-health", requirePermission("ops.read"),
  asyncHandler(async (_req, res) => {
    res.json(await courierHealthReport());
  }),
);

/** Site health: GET /api/v1/ops/errors — grouped production errors (server and website), newest first. The list never
 * carries stacks; GET /errors/:id does, for support. ops.read. */
const errorListQuery = z.object({
  status: z.enum(["open", "resolved"]).default("open"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
opsRouter.get(
  "/errors", requirePermission("ops.read"), validate(errorListQuery, "query"),
  asyncHandler(async (req, res) => {
    const { status, limit } = req.query as unknown as z.infer<typeof errorListQuery>;
    res.json({ items: await listErrorGroups(status, limit) });
  }),
);
opsRouter.get(
  "/errors/:id", requirePermission("ops.read"),
  asyncHandler(async (req, res) => {
    res.json(await getErrorGroup(req.params.id as string));
  }),
);
/** "Mark fixed" — hides the group until it happens again. ops.repair (owner), audited. */
opsRouter.post(
  "/errors/:id/resolve", requirePermission("ops.repair"),
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    await resolveErrorGroup(id);
    recordAudit({ adminId: req.admin?.adminId ?? null, action: "ops.error.resolve", entityType: "ErrorGroup", entityId: id, ipAddress: req.ip ?? null });
    res.status(204).end();
  }),
);

/** Site health: GET /api/v1/ops/vitals?days=7 — real-visitor speed, 75th percentile per metric × page kind × device. ops.read. */
const vitalsQuery = z.object({ days: z.coerce.number().int().min(1).max(30).default(7) });
opsRouter.get(
  "/vitals", requirePermission("ops.read"), validate(vitalsQuery, "query"),
  asyncHandler(async (req, res) => {
    const { days } = req.query as unknown as z.infer<typeof vitalsQuery>;
    res.json({ days, rows: await summarizeVitals(days) });
  }),
);
