import { Router } from "express";
import {
  createProductSchema,
  updateProductSchema,
  productListQuerySchema,
  storefrontProductQuerySchema,
  storefrontFacetsQuerySchema,
  productsByIdsQuerySchema,
  trendingQuerySchema,
  recommendedQuerySchema,
  suggestQuerySchema,
  popularSearchesQuerySchema,
  bulkProductIdsSchema,
  bulkProductStatusSchema,
  bulkProductCategorySchema,
  updateImageSchema,
  reorderImagesSchema,
  duplicateProductSchema,
  productImportRequestSchema,
  productImportCommitSchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { trackingRateLimit } from "../../middlewares/rate-limit";
import { imageUpload } from "../uploads/upload.middleware";
import * as productController from "./product.controller";

export const productRouter = Router();

productRouter.get(
  "/storefront",
  validate(storefrontProductQuerySchema, "query"),
  productController.storefrontList,
);
productRouter.get(
  "/storefront/facets",
  validate(storefrontFacetsQuerySchema, "query"),
  productController.storefrontFacets,
);
productRouter.get(
  "/storefront/by-ids",
  validate(productsByIdsQuerySchema, "query"),
  productController.byIds,
);
productRouter.get(
  "/storefront/trending",
  validate(trendingQuerySchema, "query"),
  productController.trending,
);
productRouter.get(
  "/storefront/recommended",
  validate(recommendedQuerySchema, "query"),
  productController.recommended,
);
productRouter.get(
  "/storefront/suggest",
  validate(suggestQuerySchema, "query"),
  productController.suggest,
);
productRouter.get(
  "/storefront/popular-searches",
  validate(popularSearchesQuerySchema, "query"),
  productController.popularSearches,
);
productRouter.get("/slug/:slug", productController.getBySlug);
productRouter.get("/:id/similar", productController.similar);
productRouter.get("/:id/rail/:key", productController.rail);
productRouter.get("/:id/frequently-bought-together", productController.frequentlyBoughtTogether);
productRouter.get("/:id/complete-your-look", productController.completeYourLook);
productRouter.get("/:id/budget-alternatives", productController.budgetAlternatives);
productRouter.get("/:id/upgrade-options", productController.upgradeOptions);
productRouter.get("/:id/premium-alternatives", productController.premiumAlternatives);
productRouter.get("/:id/urgency-signals", productController.urgencySignals);
productRouter.post("/:id/view", trackingRateLimit, productController.recordView);

productRouter.get("/export/csv", requireAdmin, requirePermission("catalog.export"), productController.exportCsv);
// The importable format (one row per variant) and its empty template. Import is the owner's: it can change prices across the whole catalog.
productRouter.get("/export/full", requireAdmin, requirePermission("catalog.export"), productController.exportFull);
productRouter.get("/import/template", requireAdmin, requirePermission("catalog.read"), productController.importTemplate);
productRouter.post("/import/validate", requireAdmin, requirePermission("products.import"), validate(productImportRequestSchema), productController.importValidate);
productRouter.post("/import/commit", requireAdmin, requirePermission("products.import"), validate(productImportCommitSchema), productController.importCommit);
// Both of these return full records (costPrice included, isActive/deletedAt unfiltered) and are
// only ever called from the admin console — the storefront uses GET /storefront and GET /slug/:slug.
productRouter.get("/", requireAdmin, requirePermission("catalog.read"), validate(productListQuerySchema, "query"), productController.list);
productRouter.get("/:id", requireAdmin, requirePermission("catalog.read"), productController.getOne);
productRouter.get("/:id/history", requireAdmin, requirePermission("catalog.read"), productController.history);
productRouter.get("/:id/sales-summary", requireAdmin, requirePermission("catalog.read"), productController.salesSummary);
productRouter.get("/:id/preview", requireAdmin, requirePermission("catalog.read"), productController.preview);

productRouter.post("/bulk/delete", requireAdmin, requirePermission("catalog.manage"), validate(bulkProductIdsSchema), productController.bulkDelete);
productRouter.post("/bulk/status", requireAdmin, requirePermission("catalog.manage"), validate(bulkProductStatusSchema), productController.bulkStatus);
productRouter.post("/bulk/category", requireAdmin, requirePermission("catalog.manage"), validate(bulkProductCategorySchema), productController.bulkCategory);

productRouter.post("/", requireAdmin, requirePermission("catalog.manage"), validate(createProductSchema), productController.create);
productRouter.patch("/:id", requireAdmin, requirePermission("catalog.manage"), validate(updateProductSchema), productController.update);
productRouter.delete("/:id", requireAdmin, requirePermission("catalog.manage"), productController.remove);
productRouter.post("/:id/restore", requireAdmin, requirePermission("catalog.manage"), productController.restore);
productRouter.post("/:id/duplicate", requireAdmin, requirePermission("catalog.manage"), validate(duplicateProductSchema), productController.duplicate);
// Irreversible (it also deletes the image files), so it is the owner's call, not staff's.
productRouter.delete("/:id/permanent", requireAdmin, requirePermission("catalog.purge"), productController.permanentlyRemove);

productRouter.post(
  "/:id/images",
  requireAdmin,
  requirePermission("catalog.manage"),
  imageUpload.array("images", 10),
  productController.uploadImages,
);
productRouter.patch(
  "/:id/images/reorder",
  requireAdmin,
  requirePermission("catalog.manage"),
  validate(reorderImagesSchema),
  productController.reorderImages,
);
productRouter.delete("/:id/images/:imageId", requireAdmin, requirePermission("catalog.manage"), productController.removeImage);
productRouter.patch(
  "/:id/images/:imageId",
  requireAdmin,
  requirePermission("catalog.manage"),
  validate(updateImageSchema),
  productController.updateImage,
);
