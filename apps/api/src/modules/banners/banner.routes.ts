import { Router } from "express";
import { createBannerSchema, updateBannerSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
import { imageUpload } from "../uploads/upload.middleware";
import * as bannerController from "./banner.controller";

export const bannerRouter = Router();

bannerRouter.get("/active", bannerController.active);

bannerRouter.get("/", requireAdmin, bannerController.list);
bannerRouter.post("/upload-image", requireAdmin, imageUpload.single("image"), bannerController.uploadImage);
bannerRouter.post("/", requireAdmin, validate(createBannerSchema), bannerController.create);
bannerRouter.patch("/:id", requireAdmin, validate(updateBannerSchema), bannerController.update);
bannerRouter.delete("/:id", requireAdmin, bannerController.remove);
