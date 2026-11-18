import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import { getMonthTargets, setMonthTargets } from "./targets.service";
import { getScorecard } from "./scorecard.service";

/** Monthly targets: read with the month's progress (analytics.read), set by the owner (settings.manage). */
export const targetsRouter = Router();
targetsRouter.use(requireAdmin);

const amount = z.number().positive().max(1e11).nullable().optional();
const setTargetsSchema = z
  .object({ netSales: amount, orders: z.number().int().positive().max(1e9).nullable().optional(), profit: amount })
  .strict();

targetsRouter.get(
  "/:month/scorecard",
  requirePermission("analytics.read"),
  asyncHandler(async (req, res) => res.json(await getScorecard(req.params.month!, req.admin!))),
);

targetsRouter.get(
  "/:month",
  requirePermission("analytics.read"),
  asyncHandler(async (req, res) => res.json(await getMonthTargets(req.params.month!, req.admin!))),
);

targetsRouter.put(
  "/:month",
  requirePermission("settings.manage"),
  validate(setTargetsSchema),
  asyncHandler(async (req, res) => {
    await setMonthTargets(req.params.month!, req.body, req.admin!.adminId);
    res.json(await getMonthTargets(req.params.month!, req.admin!));
  }),
);
