import { Router } from "express";
import { createLandingPageSchema, duplicateLandingPageSchema, saveLandingPageSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { imageUpload } from "../uploads/upload.middleware";
import * as controller from "./landing-page.controller";

// Campaign landing pages (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §2) — Marketing, like the existing landing-page list.
export const landingPageRouter = Router();
const access = [requireAdmin, requirePermission("promotions.manage")];

landingPageRouter.get("/public/:slug", controller.publicBySlug);

landingPageRouter.get("/", ...access, controller.list);
landingPageRouter.post("/", ...access, validate(createLandingPageSchema), controller.create);
landingPageRouter.post("/upload-image", ...access, imageUpload.single("image"), controller.uploadImage);
landingPageRouter.get("/:id", ...access, controller.getOne);
landingPageRouter.get("/:id/preview", ...access, controller.preview);
landingPageRouter.put("/:id", ...access, validate(saveLandingPageSchema), controller.save);
landingPageRouter.post("/:id/publish", ...access, controller.publish);
landingPageRouter.post("/:id/unpublish", ...access, controller.unpublish);
landingPageRouter.post("/:id/duplicate", ...access, validate(duplicateLandingPageSchema), controller.duplicate);
landingPageRouter.delete("/:id", ...access, controller.remove);
