import { Router } from "express";
import { createAttributeSchema, updateAttributeSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import * as attributeController from "./attribute.controller";

export const attributeRouter = Router();

attributeRouter.get("/", attributeController.list);
attributeRouter.get("/:id", attributeController.getOne);

attributeRouter.post("/", requireAdmin, requirePermission("catalog.manage"), validate(createAttributeSchema), attributeController.create);
attributeRouter.patch("/:id", requireAdmin, requirePermission("catalog.manage"), validate(updateAttributeSchema), attributeController.update);
attributeRouter.delete("/:id", requireAdmin, requirePermission("catalog.manage"), attributeController.remove);
