import { Router } from "express";
import {
  createHomepageSectionSchema,
  publishStudioDraftSchema,
  saveStudioDraftSchema,
  reorderHomepageSectionsSchema,
  updateHomepageSectionSchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { imageUpload } from "../uploads/upload.middleware";
import * as homepageSectionController from "./homepage-section.controller";

export const homepageSectionRouter = Router();

homepageSectionRouter.get("/active", homepageSectionController.active);

// Storefront Studio: the autosaved homepage draft, publish, and the publish history.
const studioAccess = [requireAdmin, requirePermission("content.manage")];
homepageSectionRouter.get("/studio", ...studioAccess, homepageSectionController.studio);
homepageSectionRouter.put("/studio/draft", ...studioAccess, validate(saveStudioDraftSchema), homepageSectionController.saveStudioDraft);
homepageSectionRouter.delete("/studio/draft", ...studioAccess, homepageSectionController.discardStudioDraft);
homepageSectionRouter.post("/studio/publish", ...studioAccess, validate(publishStudioDraftSchema), homepageSectionController.publishStudioDraft);
homepageSectionRouter.get("/studio/revisions", ...studioAccess, homepageSectionController.studioRevisions);
homepageSectionRouter.post("/studio/revisions/:id/restore", ...studioAccess, homepageSectionController.restoreStudioRevision);

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
