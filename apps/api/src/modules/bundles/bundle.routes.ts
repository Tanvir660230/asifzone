import { Router } from "express";
import { createBundleSchema, updateBundleSchema, bundleListQuerySchema, bundlePreviewSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
import { checkoutRateLimit } from "../../middlewares/rate-limit";
import * as bundleController from "./bundle.controller";

export const bundleRouter = Router();

bundleRouter.get("/for-product/:productId", bundleController.forProduct);
bundleRouter.post("/preview", checkoutRateLimit, validate(bundlePreviewSchema), bundleController.preview);

bundleRouter.get("/", requireAdmin, validate(bundleListQuerySchema, "query"), bundleController.list);
bundleRouter.get("/:id", requireAdmin, bundleController.getOne);
bundleRouter.post("/", requireAdmin, validate(createBundleSchema), bundleController.create);
bundleRouter.patch("/:id", requireAdmin, validate(updateBundleSchema), bundleController.update);
bundleRouter.delete("/:id", requireAdmin, bundleController.remove);
