import { Router } from "express";
import { createSocialLinkSchema, updateSocialLinkSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import * as socialLinkController from "./social-link.controller";

export const socialLinkRouter = Router();

socialLinkRouter.get("/active", socialLinkController.active);

socialLinkRouter.get("/", requireAdmin, requirePermission("content.manage"), socialLinkController.list);
// OWNER-only, same as settings.routes.ts — these are public-facing branding/contact links, the
// same trust tier as the store's logo/contact widget config, so any STAFF being able to change
// the storefront's public WhatsApp/contact links was an inconsistency, not a deliberate choice.
socialLinkRouter.post(
  "/",
  requireAdmin,
  requirePermission("storefront.configure"),
  validate(createSocialLinkSchema),
  socialLinkController.create,
);
socialLinkRouter.patch(
  "/:id",
  requireAdmin,
  requirePermission("storefront.configure"),
  validate(updateSocialLinkSchema),
  socialLinkController.update,
);
socialLinkRouter.delete("/:id", requireAdmin, requirePermission("storefront.configure"), socialLinkController.remove);
