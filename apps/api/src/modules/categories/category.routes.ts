import { Router } from "express";
import {
  createCategorySchema,
  updateCategorySchema,
  reorderCategoriesSchema,
  moveCategorySchema,
  categoryListQuerySchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { imageUpload } from "../uploads/upload.middleware";
import * as categoryController from "./category.controller";

export const categoryRouter = Router();

// "/" and "/:id" are the admin-shaped reads (every category regardless of isActive, for the
// dashboard's own management UI) — unlike "/tree" and "/slug/:slug" below, which are the
// deliberately public, active-only reads the storefront actually links to.
categoryRouter.get("/", requireAdmin, requirePermission("catalog.read"), validate(categoryListQuerySchema, "query"), categoryController.list);
categoryRouter.get("/tree", categoryController.tree);
categoryRouter.get("/stock-map", requireAdmin, requirePermission("inventory.read"), categoryController.stockMap);
categoryRouter.get("/slug/:slug", categoryController.getBySlug);
categoryRouter.get("/slug/:slug/stock", categoryController.stockOverviewBySlug);
categoryRouter.get("/:id", requireAdmin, requirePermission("catalog.read"), categoryController.getOne);

categoryRouter.post("/upload-image", requireAdmin, requirePermission("catalog.manage"), imageUpload.single("image"), categoryController.uploadImage);
categoryRouter.post(
  "/upload-banner",
  requireAdmin,
  requirePermission("catalog.manage"),
  imageUpload.single("image"),
  categoryController.uploadBannerImage,
);
categoryRouter.post("/", requireAdmin, requirePermission("catalog.manage"), validate(createCategorySchema), categoryController.create);
categoryRouter.post("/reorder", requireAdmin, requirePermission("catalog.manage"), validate(reorderCategoriesSchema), categoryController.reorder);
categoryRouter.patch("/:id", requireAdmin, requirePermission("catalog.manage"), validate(updateCategorySchema), categoryController.update);
categoryRouter.post("/:id/move", requireAdmin, requirePermission("catalog.manage"), validate(moveCategorySchema), categoryController.move);
categoryRouter.delete("/:id", requireAdmin, requirePermission("catalog.manage"), categoryController.remove);
categoryRouter.post("/:id/restore", requireAdmin, requirePermission("catalog.manage"), categoryController.restore);
categoryRouter.delete("/:id/permanent", requireAdmin, requirePermission("catalog.manage"), categoryController.permanentlyRemove);
