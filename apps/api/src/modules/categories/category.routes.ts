import { Router } from "express";
import { createCategorySchema, updateCategorySchema, reorderCategoriesSchema, moveCategorySchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
import { imageUpload } from "../uploads/upload.middleware";
import * as categoryController from "./category.controller";

export const categoryRouter = Router();

// "/" and "/:id" are the admin-shaped reads (every category regardless of isActive, for the
// dashboard's own management UI) — unlike "/tree" and "/slug/:slug" below, which are the
// deliberately public, active-only reads the storefront actually links to.
categoryRouter.get("/", requireAdmin, categoryController.list);
categoryRouter.get("/tree", categoryController.tree);
categoryRouter.get("/slug/:slug", categoryController.getBySlug);
categoryRouter.get("/:id", requireAdmin, categoryController.getOne);

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
categoryRouter.post("/:id/move", requireAdmin, validate(moveCategorySchema), categoryController.move);
categoryRouter.delete("/:id", requireAdmin, categoryController.remove);
