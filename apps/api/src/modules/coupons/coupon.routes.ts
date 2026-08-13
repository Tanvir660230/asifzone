import { Router } from "express";
import {
  validateCouponSchema,
  createCouponSchema,
  updateCouponSchema,
  couponListQuerySchema,
  bestCouponSchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
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

couponRouter.get("/", requireAdmin, validate(couponListQuerySchema, "query"), couponController.list);
couponRouter.get("/:id", requireAdmin, couponController.getOne);
couponRouter.post("/", requireAdmin, validate(createCouponSchema), couponController.create);
couponRouter.patch("/:id", requireAdmin, validate(updateCouponSchema), couponController.update);
couponRouter.delete("/:id", requireAdmin, couponController.remove);
couponRouter.post("/:id/restore", requireAdmin, couponController.restore);
couponRouter.delete("/:id/permanent", requireAdmin, couponController.permanentlyRemove);
