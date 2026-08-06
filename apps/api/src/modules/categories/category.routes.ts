import { Router } from "express";
import { createCategorySchema, updateCategorySchema, reorderCategoriesSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
import { imageUpload } from "../uploads/upload.middleware";
import * as categoryController from "./category.controller";

export const categoryRouter = Router();

categoryRouter.get("/", categoryController.list);
categoryRouter.get("/tree", categoryController.tree);
categoryRouter.get("/slug/:slug", categoryController.getBySlug);
categoryRouter.get("/:id", categoryController.getOne);

categoryRouter.post("/upload-image", requireAdmin, imageUpload.single("image"), categoryController.uploadImage);
categoryRouter.post(
  "/upload-banner",
  requireAdmin,
  imageUpload.single("image"),
  categoryController.uploadBannerImage,
);
categoryRouter.post("/", requireAdmin, validate(createCategorySchema), categoryController.create);
categoryRouter.post("/reorder", requireAdmin, validate(reorderCategoriesSchema), categoryController.reorder);
categoryRouter.patch("/:id", requireAdmin, validate(updateCategorySchema), categoryController.update);
categoryRouter.delete("/:id", requireAdmin, categoryController.remove);
