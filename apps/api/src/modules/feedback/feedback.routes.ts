import { Router } from "express";
import { createFeedbackSchema, feedbackListQuerySchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { checkoutRateLimit } from "../../middlewares/rate-limit";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import * as feedbackController from "./feedback.controller";

export const feedbackRouter = Router();

feedbackRouter.post("/", checkoutRateLimit, validate(createFeedbackSchema), feedbackController.create);

feedbackRouter.get("/", requireAdmin, requirePermission("content.manage"), validate(feedbackListQuerySchema, "query"), feedbackController.list);
feedbackRouter.patch("/:id/read", requireAdmin, requirePermission("content.manage"), feedbackController.markRead);
feedbackRouter.delete("/:id", requireAdmin, requirePermission("content.manage"), feedbackController.remove);
