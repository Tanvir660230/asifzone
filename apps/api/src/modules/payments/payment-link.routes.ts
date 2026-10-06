import { Router } from "express";
import { startPaymentLinkSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { paymentLinkRateLimit } from "../../middlewares/rate-limit";
import * as adjustments from "../orders/order-adjustments.controller";

/** Public payment-link pages (docs/ORDER_ADJUSTMENTS.md §11): the 256-bit token in the path is the capability. */
export const paymentLinkRouter = Router();

paymentLinkRouter.get("/:token", paymentLinkRateLimit, adjustments.viewLink);
paymentLinkRouter.post("/:token/start", paymentLinkRateLimit, validate(startPaymentLinkSchema), adjustments.startLink);
