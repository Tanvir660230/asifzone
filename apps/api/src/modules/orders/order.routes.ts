import { Router } from "express";
import {
  checkoutSchema,
  orderListQuerySchema,
  updateOrderStatusSchema,
  updateOrderDetailsSchema,
  trackOrderSchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
import { attachCustomerIfPresent } from "../../middlewares/require-customer";
import { checkoutRateLimit } from "../../middlewares/rate-limit";
import * as orderController from "./order.controller";

export const orderRouter = Router();

orderRouter.post("/", checkoutRateLimit, attachCustomerIfPresent, validate(checkoutSchema), orderController.create);
orderRouter.post("/track", checkoutRateLimit, validate(trackOrderSchema), orderController.track);

orderRouter.get("/", requireAdmin, validate(orderListQuerySchema, "query"), orderController.list);
orderRouter.get("/:id", requireAdmin, orderController.getOne);
orderRouter.patch("/:id/status", requireAdmin, validate(updateOrderStatusSchema), orderController.updateStatus);
orderRouter.patch("/:id/details", requireAdmin, validate(updateOrderDetailsSchema), orderController.updateDetails);
