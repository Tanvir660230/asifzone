import { Router } from "express";
import {
  validateCouponSchema,
  createCouponSchema,
  updateCouponSchema,
  couponListQuerySchema,
  bestCouponQuerySchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
import { couponValidateRateLimit } from "../../middlewares/rate-limit";
import * as couponController from "./coupon.controller";

export const couponRouter = Router();

couponRouter.post("/validate", couponValidateRateLimit, validate(validateCouponSchema), couponController.validate);
couponRouter.get("/best", validate(bestCouponQuerySchema, "query"), couponController.best);
couponRouter.get("/active", couponController.active);

couponRouter.get("/", requireAdmin, validate(couponListQuerySchema, "query"), couponController.list);
couponRouter.get("/:id", requireAdmin, couponController.getOne);
couponRouter.post("/", requireAdmin, validate(createCouponSchema), couponController.create);
couponRouter.patch("/:id", requireAdmin, validate(updateCouponSchema), couponController.update);
couponRouter.delete("/:id", requireAdmin, couponController.remove);
