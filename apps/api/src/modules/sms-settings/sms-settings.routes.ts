import { Router } from "express";
import { updateSmsSettingsSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requireRole } from "../../middlewares/require-admin";
import * as smsSettingsController from "./sms-settings.controller";

export const smsSettingsRouter = Router();

// Unlike settingsRouter, GET here is NOT public — adminAlertPhones must never be exposed to a
// storefront visitor, so both routes are OWNER-gated.
smsSettingsRouter.get("/", requireAdmin, requireRole("OWNER"), smsSettingsController.get);
smsSettingsRouter.patch(
  "/",
  requireAdmin,
  requireRole("OWNER"),
  validate(updateSmsSettingsSchema),
  smsSettingsController.update,
);
