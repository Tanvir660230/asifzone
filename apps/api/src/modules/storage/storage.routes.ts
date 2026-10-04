import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { asyncHandler } from "../../lib/async-handler";
import { validate } from "../../middlewares/validate";
import { findUnusedUploads, listTrash, moveUnusedToTrash, restoreTrashBatch } from "./storage.service";

export const storageRouter = Router();

// OWNER-only (`storage.manage`): moving files out of the live uploads folder is a store-wide action.
storageRouter.use(requireAdmin);

storageRouter.get(
  "/unused",
  requirePermission("storage.manage"),
  asyncHandler(async (_req, res) => {
    res.json(await findUnusedUploads());
  }),
);

const trashSchema = z.object({ paths: z.array(z.string().min(1)).max(5000).optional() });

storageRouter.post(
  "/unused/trash",
  requirePermission("storage.manage"),
  validate(trashSchema),
  asyncHandler(async (req, res) => {
    res.json(await moveUnusedToTrash((req.body as z.infer<typeof trashSchema>).paths));
  }),
);

storageRouter.get(
  "/trash",
  requirePermission("storage.manage"),
  asyncHandler(async (_req, res) => {
    res.json({ batches: await listTrash() });
  }),
);

storageRouter.post(
  "/trash/:batch/restore",
  requirePermission("storage.manage"),
  asyncHandler(async (req, res) => {
    res.json(await restoreTrashBatch(req.params.batch!));
  }),
);
