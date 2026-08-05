import { Router } from "express";
import { createSocialLinkSchema, updateSocialLinkSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
import * as socialLinkController from "./social-link.controller";

export const socialLinkRouter = Router();

socialLinkRouter.get("/active", socialLinkController.active);

socialLinkRouter.get("/", requireAdmin, socialLinkController.list);
socialLinkRouter.post("/", requireAdmin, validate(createSocialLinkSchema), socialLinkController.create);
socialLinkRouter.patch("/:id", requireAdmin, validate(updateSocialLinkSchema), socialLinkController.update);
socialLinkRouter.delete("/:id", requireAdmin, socialLinkController.remove);
