import { Router } from "express";
import { createSmsTemplateSchema, updateSmsTemplateSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import * as smsTemplateController from "./sms-template.controller";

export const smsTemplateRouter = Router();

smsTemplateRouter.use(requireAdmin);

smsTemplateRouter.get("/", requirePermission("campaigns.manage"), smsTemplateController.list);
smsTemplateRouter.post("/", requirePermission("campaigns.manage"), validate(createSmsTemplateSchema), smsTemplateController.create);
smsTemplateRouter.patch("/:id", requirePermission("campaigns.manage"), validate(updateSmsTemplateSchema), smsTemplateController.update);
smsTemplateRouter.delete("/:id", requirePermission("campaigns.manage"), smsTemplateController.remove);
