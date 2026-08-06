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
  updateImageAltTextSchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
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
productRouter.get("/:id/frequently-bought-together", productController.frequentlyBoughtTogether);
productRouter.get("/:id/complete-your-look", productController.completeYourLook);
productRouter.get("/:id/budget-alternatives", productController.budgetAlternatives);
productRouter.get("/:id/upgrade-options", productController.upgradeOptions);
productRouter.get("/:id/premium-alternatives", productController.premiumAlternatives);
productRouter.get("/:id/urgency-signals", productController.urgencySignals);
productRouter.post("/:id/view", trackingRateLimit, productController.recordView);

productRouter.get("/export/csv", requireAdmin, productController.exportCsv);
// Both of these return full records (costPrice included, isActive/deletedAt unfiltered) and are
// only ever called from the admin console — the storefront uses GET /storefront and GET /slug/:slug.
productRouter.get("/", requireAdmin, validate(productListQuerySchema, "query"), productController.list);
productRouter.get("/:id", requireAdmin, productController.getOne);

productRouter.post("/bulk/delete", requireAdmin, validate(bulkProductIdsSchema), productController.bulkDelete);
productRouter.post("/bulk/status", requireAdmin, validate(bulkProductStatusSchema), productController.bulkStatus);
productRouter.post("/bulk/category", requireAdmin, validate(bulkProductCategorySchema), productController.bulkCategory);

productRouter.post("/", requireAdmin, validate(createProductSchema), productController.create);
productRouter.patch("/:id", requireAdmin, validate(updateProductSchema), productController.update);
productRouter.delete("/:id", requireAdmin, productController.remove);
productRouter.post("/:id/restore", requireAdmin, productController.restore);
productRouter.delete("/:id/permanent", requireAdmin, productController.permanentlyRemove);

productRouter.post(
  "/:id/images",
  requireAdmin,
  imageUpload.array("images", 10),
  productController.uploadImages,
);
productRouter.delete("/:id/images/:imageId", requireAdmin, productController.removeImage);
productRouter.patch(
  "/:id/images/:imageId",
  requireAdmin,
  validate(updateImageAltTextSchema),
  productController.updateImageAltText,
);
