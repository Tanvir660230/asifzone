import { Router } from "express";
import { updateSmsSettingsSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import * as smsSettingsController from "./sms-settings.controller";

export const smsSettingsRouter = Router();

// Unlike settingsRouter, GET here is NOT public — adminAlertPhones must never be exposed to a
// storefront visitor, so both routes are OWNER-gated.
smsSettingsRouter.get("/", requireAdmin, requirePermission("settings.manage"), smsSettingsController.get);
smsSettingsRouter.patch(
  "/",
  requireAdmin,
  requirePermission("settings.manage"),
  validate(updateSmsSettingsSchema),
  smsSettingsController.update,
);
