import { Router } from "express";
import {
  validateCouponSchema,
  createCouponSchema,
  updateCouponSchema,
  couponListQuerySchema,
  bestCouponSchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { attachCustomerIfPresent } from "../../middlewares/require-customer";
import { couponValidateRateLimit } from "../../middlewares/rate-limit";
import * as couponController from "./coupon.controller";

export const couponRouter = Router();

couponRouter.post(
  "/validate",
  couponValidateRateLimit,
  attachCustomerIfPresent,
  validate(validateCouponSchema),
  couponController.validate,
);
couponRouter.post("/best", attachCustomerIfPresent, validate(bestCouponSchema), couponController.best);
couponRouter.get("/active", couponController.active);

couponRouter.get("/", requireAdmin, requirePermission("promotions.manage"), validate(couponListQuerySchema, "query"), couponController.list);
couponRouter.get("/:id", requireAdmin, requirePermission("promotions.manage"), couponController.getOne);
couponRouter.post("/", requireAdmin, requirePermission("promotions.manage"), validate(createCouponSchema), couponController.create);
couponRouter.patch("/:id", requireAdmin, requirePermission("promotions.manage"), validate(updateCouponSchema), couponController.update);
couponRouter.delete("/:id", requireAdmin, requirePermission("promotions.manage"), couponController.remove);
couponRouter.post("/:id/restore", requireAdmin, requirePermission("promotions.manage"), couponController.restore);
couponRouter.delete("/:id/permanent", requireAdmin, requirePermission("promotions.purge"), couponController.permanentlyRemove);
