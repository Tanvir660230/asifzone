import { Router } from "express";
import { createRedirectSchema, updateRedirectSchema, redirectListQuerySchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
import * as redirectController from "./redirect.controller";

export const redirectRouter = Router();

redirectRouter.get("/active", redirectController.active);

redirectRouter.get("/", requireAdmin, validate(redirectListQuerySchema, "query"), redirectController.list);
redirectRouter.get("/:id", requireAdmin, redirectController.getOne);
redirectRouter.post("/", requireAdmin, validate(createRedirectSchema), redirectController.create);
redirectRouter.patch("/:id", requireAdmin, validate(updateRedirectSchema), redirectController.update);
redirectRouter.delete("/:id", requireAdmin, redirectController.remove);
