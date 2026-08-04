import { Router } from "express";
import { subscribeNewsletterSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { checkoutRateLimit } from "../../middlewares/rate-limit";
import * as newsletterController from "./newsletter.controller";

export const newsletterRouter = Router();

newsletterRouter.post(
  "/subscribe",
  checkoutRateLimit,
  validate(subscribeNewsletterSchema),
  newsletterController.subscribe,
);
