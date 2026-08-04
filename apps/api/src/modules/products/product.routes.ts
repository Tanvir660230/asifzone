import { Router } from "express";
import {
  createProductSchema,
  updateProductSchema,
  productListQuerySchema,
  storefrontProductQuerySchema,
  storefrontFacetsQuerySchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
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
productRouter.get("/slug/:slug", productController.getBySlug);

productRouter.get("/", validate(productListQuerySchema, "query"), productController.list);
productRouter.get("/:id", productController.getOne);

productRouter.post("/", requireAdmin, validate(createProductSchema), productController.create);
productRouter.patch("/:id", requireAdmin, validate(updateProductSchema), productController.update);
productRouter.delete("/:id", requireAdmin, productController.remove);

productRouter.post(
  "/:id/images",
  requireAdmin,
  imageUpload.array("images", 10),
  productController.uploadImages,
);
productRouter.delete("/:id/images/:imageId", requireAdmin, productController.removeImage);
