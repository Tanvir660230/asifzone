import { Router } from "express";
import { requireAdmin, requireSelf } from "../../middlewares/require-admin";
import { asyncHandler } from "../../lib/async-handler";
import { createSavedViewSchema, savedViewListQuerySchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { adminAttention } from "./attention.service";
import { createSavedView, deleteSavedView, listSavedViews } from "./saved-views.service";

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

/** Saved list views (DR-18) — the caller's own plus the team's shared ones; any admin manages their own. */
adminHomeRouter.get(
  "/views", requireSelf, validate(savedViewListQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    res.json({ items: await listSavedViews(req.admin!.adminId, String(req.query.list)) });
  }),
);
adminHomeRouter.post(
  "/views", requireSelf, validate(createSavedViewSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createSavedView(req.admin!.adminId, req.body));
  }),
);
adminHomeRouter.delete(
  "/views/:id", requireSelf,
  asyncHandler(async (req, res) => {
    await deleteSavedView(req.admin!.adminId, req.params.id!);
    res.status(204).send();
  }),
);
