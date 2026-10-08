import { Router } from "express";
import { createFeedbackSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { checkoutRateLimit } from "../../middlewares/rate-limit";
import * as feedbackController from "./feedback.controller";

export const feedbackRouter = Router();

// The storefront contact form. Staff read and answer these in Messages › Inbox (/api/v1/admin/conversations).
feedbackRouter.post("/", checkoutRateLimit, validate(createFeedbackSchema), feedbackController.create);
