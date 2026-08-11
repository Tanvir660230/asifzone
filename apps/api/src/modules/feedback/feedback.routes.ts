import { Router } from "express";
import { createFeedbackSchema, feedbackListQuerySchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { checkoutRateLimit } from "../../middlewares/rate-limit";
import { requireAdmin } from "../../middlewares/require-admin";
import * as feedbackController from "./feedback.controller";

export const feedbackRouter = Router();

feedbackRouter.post("/", checkoutRateLimit, validate(createFeedbackSchema), feedbackController.create);

feedbackRouter.get("/", requireAdmin, validate(feedbackListQuerySchema, "query"), feedbackController.list);
feedbackRouter.patch("/:id/read", requireAdmin, feedbackController.markRead);
feedbackRouter.delete("/:id", requireAdmin, feedbackController.remove);
