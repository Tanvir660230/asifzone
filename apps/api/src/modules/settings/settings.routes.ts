import { Router } from "express";
import { updateSettingsSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { imageUpload } from "../uploads/upload.middleware";
import * as settingsController from "./settings.controller";

export const settingsRouter = Router();

// No secrets live on this model (no gateway keys, no SMTP credentials) — every field here is safe to
// read publicly, and the storefront needs several of them (name, social links, shipping fee).
settingsRouter.get("/", settingsController.get);
// Store-wide config (payment/shipping/tax) — OWNER-only; a STAFF account shouldn't be able to
// change what the whole store charges or how it's branded.
// Reconciliation: do the legacy StoreSetting mirrors still match the TaxSetting / ShippingZone authorities?
// (docs/PRICING_INVARIANTS.md §10). Empty `drift` = consistent.
settingsRouter.get("/pricing-config-drift", requireAdmin, requirePermission("ops.read"), settingsController.pricingDrift);
settingsRouter.patch("/", requireAdmin, requirePermission("settings.manage"), validate(updateSettingsSchema), settingsController.update);
settingsRouter.post(
  "/upload-logo",
  requireAdmin,
  requirePermission("settings.manage"),
  imageUpload.single("image"),
  settingsController.uploadLogo,
);
settingsRouter.post(
  "/upload-favicon",
  requireAdmin,
  requirePermission("settings.manage"),
  imageUpload.single("image"),
  settingsController.uploadFavicon,
);
settingsRouter.post(
  "/upload-payment-methods-image",
  requireAdmin,
  requirePermission("settings.manage"),
  imageUpload.single("image"),
  settingsController.uploadPaymentMethodsImage,
);
