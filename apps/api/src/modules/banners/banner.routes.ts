import { Router } from "express";
import { createBannerSchema, updateBannerSchema, activeBannersQuerySchema, reorderBannersSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { imageUpload } from "../uploads/upload.middleware";
import * as bannerController from "./banner.controller";

export const bannerRouter = Router();

bannerRouter.get("/active", validate(activeBannersQuerySchema, "query"), bannerController.active);

bannerRouter.get("/", requireAdmin, requirePermission("content.manage"), bannerController.list);
bannerRouter.post("/upload-image", requireAdmin, requirePermission("content.manage"), imageUpload.single("image"), bannerController.uploadImage);
bannerRouter.post("/", requireAdmin, requirePermission("content.manage"), validate(createBannerSchema), bannerController.create);
bannerRouter.patch("/reorder", requireAdmin, requirePermission("content.manage"), validate(reorderBannersSchema), bannerController.reorder);
bannerRouter.patch("/:id", requireAdmin, requirePermission("content.manage"), validate(updateBannerSchema), bannerController.update);
bannerRouter.delete("/:id", requireAdmin, requirePermission("content.manage"), bannerController.remove);
