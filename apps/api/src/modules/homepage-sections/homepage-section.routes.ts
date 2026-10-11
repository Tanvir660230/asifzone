import { Router } from "express";
import {
  createHomepageSectionSchema,
  reorderHomepageSectionsSchema,
  updateHomepageSectionSchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { imageUpload } from "../uploads/upload.middleware";
import * as homepageSectionController from "./homepage-section.controller";

export const homepageSectionRouter = Router();

homepageSectionRouter.get("/active", homepageSectionController.active);

homepageSectionRouter.get("/", requireAdmin, requirePermission("content.manage"), homepageSectionController.list);
homepageSectionRouter.post("/upload-image", requireAdmin, requirePermission("content.manage"), imageUpload.single("image"), homepageSectionController.uploadImage);
homepageSectionRouter.post("/", requireAdmin, requirePermission("content.manage"), validate(createHomepageSectionSchema), homepageSectionController.create);
homepageSectionRouter.patch(
  "/reorder",
  requireAdmin,
  requirePermission("content.manage"),
  validate(reorderHomepageSectionsSchema),
  homepageSectionController.reorder,
);
homepageSectionRouter.patch(
  "/:id",
  requireAdmin,
  requirePermission("content.manage"),
  validate(updateHomepageSectionSchema),
  homepageSectionController.update,
);
homepageSectionRouter.delete("/:id", requireAdmin, requirePermission("content.manage"), homepageSectionController.remove);
