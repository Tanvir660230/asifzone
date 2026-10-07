import { Router } from "express";
import { requireAdmin, requireSelf } from "../../middlewares/require-admin";
import { asyncHandler } from "../../lib/async-handler";
import { adminAttention } from "./attention.service";

/** /api/v1/admin — composite reads for the Store Console shell (Blueprint V2 PERF-03). */
export const adminHomeRouter = Router();
adminHomeRouter.use(requireAdmin);

/** GET /api/v1/admin/attention — any signed-in admin; each section is filtered to that admin's own permissions. */
adminHomeRouter.get(
  "/attention", requireSelf,
  asyncHandler(async (req, res) => {
    res.json(await adminAttention(req.admin!));
  }),
);
