import { Router } from "express";
import { saveProductFamilySchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import * as controller from "./product-family.controller";

// Product families (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §3) — Products, like the catalog itself.
export const productFamilyRouter = Router();
const access = [requireAdmin, requirePermission("catalog.manage")];

productFamilyRouter.get("/for/:productId", controller.forProduct);

productFamilyRouter.get("/", ...access, controller.list);
productFamilyRouter.post("/", ...access, validate(saveProductFamilySchema), controller.create);
productFamilyRouter.get("/:id", ...access, controller.getOne);
productFamilyRouter.put("/:id", ...access, validate(saveProductFamilySchema), controller.update);
productFamilyRouter.delete("/:id", ...access, controller.remove);
