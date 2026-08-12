import { Router } from "express";
import {
  createHomepageSectionSchema,
  reorderHomepageSectionsSchema,
  updateHomepageSectionSchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
import { imageUpload } from "../uploads/upload.middleware";
import * as homepageSectionController from "./homepage-section.controller";

export const homepageSectionRouter = Router();

homepageSectionRouter.get("/active", homepageSectionController.active);

homepageSectionRouter.get("/", requireAdmin, homepageSectionController.list);
homepageSectionRouter.post("/upload-image", requireAdmin, imageUpload.single("image"), homepageSectionController.uploadImage);
homepageSectionRouter.post("/", requireAdmin, validate(createHomepageSectionSchema), homepageSectionController.create);
homepageSectionRouter.patch(
  "/reorder",
  requireAdmin,
  validate(reorderHomepageSectionsSchema),
  homepageSectionController.reorder,
);
homepageSectionRouter.patch(
  "/:id",
  requireAdmin,
  validate(updateHomepageSectionSchema),
  homepageSectionController.update,
);
homepageSectionRouter.delete("/:id", requireAdmin, homepageSectionController.remove);
