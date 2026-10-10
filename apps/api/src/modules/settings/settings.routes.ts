import { Router } from "express";
import { createShippingZoneSchema, updateShippingZoneSchema, updateSettingsSchema } from "@clothing-brand/shared";
import { asyncHandler } from "../../lib/async-handler";
import { createShippingZone, deleteShippingZone, listShippingZones, updateShippingZone } from "./shipping-zones.service";
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

// Delivery zones (Admin V2 DR-17) — what checkout charges per address; OWNER-only like the rest of store config.
settingsRouter.get(
  "/shipping-zones", requireAdmin, requirePermission("settings.manage"),
  asyncHandler(async (_req, res) => {
    res.json({ items: await listShippingZones() });
  }),
);
settingsRouter.post(
  "/shipping-zones", requireAdmin, requirePermission("settings.manage"), validate(createShippingZoneSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createShippingZone(req.body));
  }),
);
settingsRouter.patch(
  "/shipping-zones/:id", requireAdmin, requirePermission("settings.manage"), validate(updateShippingZoneSchema),
  asyncHandler(async (req, res) => {
    res.json(await updateShippingZone(req.params.id!, req.body));
  }),
);
settingsRouter.delete(
  "/shipping-zones/:id", requireAdmin, requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    await deleteShippingZone(req.params.id!);
    res.status(204).send();
  }),
);
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
  "/upload-social-image",
  requireAdmin,
  requirePermission("settings.manage"),
  imageUpload.single("image"),
  settingsController.uploadSocialImage,
);
settingsRouter.post(
  "/upload-payment-methods-image",
  requireAdmin,
  requirePermission("settings.manage"),
  imageUpload.single("image"),
  settingsController.uploadPaymentMethodsImage,
);
