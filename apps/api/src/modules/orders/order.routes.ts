import { Router } from "express";
import {
  checkoutSchema,
  orderListQuerySchema,
  updateOrderStatusSchema,
  updateOrderDetailsSchema,
  trackOrderSchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requireRole } from "../../middlewares/require-admin";
import { attachCustomerIfPresent } from "../../middlewares/require-customer";
import { orderCreateRateLimit, orderTrackRateLimit } from "../../middlewares/rate-limit";
import * as orderController from "./order.controller";

export const orderRouter = Router();

orderRouter.post(
  "/",
  orderCreateRateLimit,
  attachCustomerIfPresent,
  validate(checkoutSchema),
  orderController.create,
);
orderRouter.post("/track", orderTrackRateLimit, validate(trackOrderSchema), orderController.track);

orderRouter.get("/", requireAdmin, validate(orderListQuerySchema, "query"), orderController.list);
orderRouter.get("/:id", requireAdmin, orderController.getOne);
orderRouter.patch("/:id/status", requireAdmin, validate(updateOrderStatusSchema), orderController.updateStatus);
orderRouter.patch("/:id/details", requireAdmin, validate(updateOrderDetailsSchema), orderController.updateDetails);
orderRouter.post("/:id/courier/book", requireAdmin, orderController.bookCourier);
orderRouter.post("/:id/courier/refresh", requireAdmin, orderController.refreshCourier);
orderRouter.delete("/:id", requireAdmin, requireRole("OWNER"), orderController.remove);
orderRouter.post("/:id/restore", requireAdmin, requireRole("OWNER"), orderController.restore);
