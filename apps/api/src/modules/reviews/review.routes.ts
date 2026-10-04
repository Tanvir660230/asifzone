import { Router } from "express";
import {
  createReviewSchema,
  moderateReviewSchema,
  reviewListQuerySchema,
  myReviewQuerySchema,
  adminReviewListQuerySchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireCustomer } from "../../middlewares/require-customer";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import * as reviewController from "./review.controller";

export const reviewRouter = Router();

reviewRouter.get("/", validate(reviewListQuerySchema, "query"), reviewController.listForProduct);
reviewRouter.get("/mine", requireCustomer, validate(myReviewQuerySchema, "query"), reviewController.getMine);
reviewRouter.post("/", requireCustomer, validate(createReviewSchema), reviewController.create);

reviewRouter.get("/admin", requireAdmin, requirePermission("content.manage"), validate(adminReviewListQuerySchema, "query"), reviewController.listAdmin);
reviewRouter.patch("/admin/:id", requireAdmin, requirePermission("content.manage"), validate(moderateReviewSchema), reviewController.moderate);
reviewRouter.delete("/admin/:id", requireAdmin, requirePermission("content.manage"), reviewController.remove);
