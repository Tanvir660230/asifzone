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
import { requireAdmin } from "../../middlewares/require-admin";
import * as reviewController from "./review.controller";

export const reviewRouter = Router();

reviewRouter.get("/", validate(reviewListQuerySchema, "query"), reviewController.listForProduct);
reviewRouter.get("/mine", requireCustomer, validate(myReviewQuerySchema, "query"), reviewController.getMine);
reviewRouter.post("/", requireCustomer, validate(createReviewSchema), reviewController.create);

reviewRouter.get("/admin", requireAdmin, validate(adminReviewListQuerySchema, "query"), reviewController.listAdmin);
reviewRouter.patch("/admin/:id", requireAdmin, validate(moderateReviewSchema), reviewController.moderate);
reviewRouter.delete("/admin/:id", requireAdmin, reviewController.remove);
