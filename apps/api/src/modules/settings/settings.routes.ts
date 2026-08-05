import { Router } from "express";
import { updateSettingsSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
import { imageUpload } from "../uploads/upload.middleware";
import * as settingsController from "./settings.controller";

export const settingsRouter = Router();

// No secrets live on this model (no gateway keys, no SMTP credentials) — every field here is safe to
// read publicly, and the storefront needs several of them (name, social links, shipping fee).
settingsRouter.get("/", settingsController.get);
settingsRouter.patch("/", requireAdmin, validate(updateSettingsSchema), settingsController.update);
settingsRouter.post("/upload-logo", requireAdmin, imageUpload.single("image"), settingsController.uploadLogo);
