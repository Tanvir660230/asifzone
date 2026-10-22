import { Router } from "express";
import { createSavedAnswerSchema, updateSavedAnswerSchema } from "@clothing-brand/shared";
import { requireAdmin, requirePermission } from "../../../middlewares/require-admin";
import { validate } from "../../../middlewares/validate";
import { asyncHandler } from "../../../lib/async-handler";
import { createSavedAnswer, deleteSavedAnswer, listSavedAnswers, updateSavedAnswer } from "./saved-answers.service";

/** /api/v1/admin/saved-answers — Messages › Saved answers: the answers the Inbox learned. Reading: content.manage (as the
 * Inbox); approving, editing and auto-send: customers.message (what lets staff reply to customers at all). */
export const savedAnswersRouter = Router();
savedAnswersRouter.use(requireAdmin);

savedAnswersRouter.get(
  "/", requirePermission("content.manage"),
  asyncHandler(async (_req, res) => {
    res.json(await listSavedAnswers());
  }),
);
savedAnswersRouter.post(
  "/", requirePermission("customers.message"), validate(createSavedAnswerSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createSavedAnswer(req.body, req.admin!.adminId));
  }),
);
savedAnswersRouter.patch(
  "/:id", requirePermission("customers.message"), validate(updateSavedAnswerSchema),
  asyncHandler(async (req, res) => {
    res.json(await updateSavedAnswer(req.params.id!, req.body, req.admin!.adminId));
  }),
);
savedAnswersRouter.delete(
  "/:id", requirePermission("customers.message"),
  asyncHandler(async (req, res) => {
    await deleteSavedAnswer(req.params.id!);
    res.status(204).send();
  }),
);
