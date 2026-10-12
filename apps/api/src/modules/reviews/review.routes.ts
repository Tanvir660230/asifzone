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
import { reviewImageRateLimit } from "../../middlewares/rate-limit";
import { asyncHandler } from "../../lib/async-handler";
import { imageUpload } from "../uploads/upload.middleware";
import { processReviewImage } from "../uploads/upload.service";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import * as reviewController from "./review.controller";

export const reviewRouter = Router();

reviewRouter.get("/", validate(reviewListQuerySchema, "query"), reviewController.listForProduct);
reviewRouter.get("/mine", requireCustomer, validate(myReviewQuerySchema, "query"), reviewController.getMine);
reviewRouter.post("/", requireCustomer, validate(createReviewSchema), reviewController.create);
// One photo per request; the review then lists the returned references (createReviewSchema.images).
reviewRouter.post(
  "/images",
  requireCustomer,
  reviewImageRateLimit,
  imageUpload.single("image"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "No image file provided" });
      return;
    }
    res.status(201).json({ url: await processReviewImage(req.file.buffer) });
  }),
);

reviewRouter.get("/admin", requireAdmin, requirePermission("content.manage"), validate(adminReviewListQuerySchema, "query"), reviewController.listAdmin);
reviewRouter.patch("/admin/:id", requireAdmin, requirePermission("content.manage"), validate(moderateReviewSchema), reviewController.moderate);
reviewRouter.delete("/admin/:id", requireAdmin, requirePermission("content.manage"), reviewController.remove);
