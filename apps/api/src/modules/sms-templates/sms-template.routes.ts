import { Router } from "express";
import { createSmsTemplateSchema, updateSmsTemplateSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
import * as smsTemplateController from "./sms-template.controller";

export const smsTemplateRouter = Router();

smsTemplateRouter.use(requireAdmin);

smsTemplateRouter.get("/", smsTemplateController.list);
smsTemplateRouter.post("/", validate(createSmsTemplateSchema), smsTemplateController.create);
smsTemplateRouter.patch("/:id", validate(updateSmsTemplateSchema), smsTemplateController.update);
smsTemplateRouter.delete("/:id", smsTemplateController.remove);
