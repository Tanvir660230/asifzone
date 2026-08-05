import { Router } from "express";
import { createAttributeSchema, updateAttributeSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
import * as attributeController from "./attribute.controller";

export const attributeRouter = Router();

attributeRouter.get("/", attributeController.list);
attributeRouter.get("/:id", attributeController.getOne);

attributeRouter.post("/", requireAdmin, validate(createAttributeSchema), attributeController.create);
attributeRouter.patch("/:id", requireAdmin, validate(updateAttributeSchema), attributeController.update);
attributeRouter.delete("/:id", requireAdmin, attributeController.remove);
