import { Router } from "express";
import { updateSettingsSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requireRole } from "../../middlewares/require-admin";
import { imageUpload } from "../uploads/upload.middleware";
import * as settingsController from "./settings.controller";

export const settingsRouter = Router();

// No secrets live on this model (no gateway keys, no SMTP credentials) — every field here is safe to
// read publicly, and the storefront needs several of them (name, social links, shipping fee).
settingsRouter.get("/", settingsController.get);
// Store-wide config (payment/shipping/tax) — OWNER-only; a STAFF account shouldn't be able to
// change what the whole store charges or how it's branded.
settingsRouter.patch("/", requireAdmin, requireRole("OWNER"), validate(updateSettingsSchema), settingsController.update);
settingsRouter.post(
  "/upload-logo",
  requireAdmin,
  requireRole("OWNER"),
  imageUpload.single("image"),
  settingsController.uploadLogo,
);
