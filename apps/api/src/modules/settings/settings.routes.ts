import { Router } from "express";
import {
  createShippingZoneSchema,
  metaHistoryImportSchema,
  updateIntegrationsSchema,
  updateShippingZoneSchema,
  updateSettingsSchema,
  whatsAppConnectSchema,
} from "@clothing-brand/shared";
import { connectWhatsApp } from "./whatsapp-connect.service";
import { requestPastChatsImport } from "../social-inbox/history-import";
import { asyncHandler } from "../../lib/async-handler";
import { createShippingZone, deleteShippingZone, listShippingZones, updateShippingZone } from "./shipping-zones.service";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { imageUpload } from "../uploads/upload.middleware";
import * as settingsController from "./settings.controller";
import { recordAudit } from "../../lib/audit";
import { generateWebPushKeys, getIntegrationsView, updateIntegrations } from "./integrations.service";

export const settingsRouter = Router();

// No secrets live on this model (gateway keys and other credentials are in IntegrationSetting, below) — every field here is safe to
// read publicly, and the storefront needs several of them (name, social links, shipping fee).
settingsRouter.get("/", settingsController.get);
// Store-wide config (payment/shipping/tax) — OWNER-only; a STAFF account shouldn't be able to
// change what the whole store charges or how it's branded.
// Reconciliation: do the legacy StoreSetting mirrors still match the TaxSetting / ShippingZone authorities?
// (docs/PRICING_INVARIANTS.md §10). Empty `drift` = consistent.
settingsRouter.get("/pricing-config-drift", requireAdmin, requirePermission("ops.read"), settingsController.pricingDrift);
settingsRouter.patch("/", requireAdmin, requirePermission("settings.manage"), validate(updateSettingsSchema), settingsController.update);

// Integrations (Settings › Integrations): third-party credentials, OWNER-only. Secrets are write-only — the view returns
// their source and last four characters, never a value. Audited with the changed keys only.
settingsRouter.get(
  "/integrations", requireAdmin, requirePermission("settings.manage"),
  asyncHandler(async (_req, res) => {
    res.json(getIntegrationsView());
  }),
);
settingsRouter.patch(
  "/integrations", requireAdmin, requirePermission("settings.manage"), validate(updateIntegrationsSchema),
  asyncHandler(async (req, res) => {
    const keys = await updateIntegrations(req.body, req.admin?.adminId ?? null);
    res.locals.auditHandled = true;
    recordAudit({ adminId: req.admin?.adminId ?? null, action: "settings.integrations_update", entityType: "settings", entityId: "integrations", ipAddress: req.ip ?? null, metadata: { keys } });
    res.json(getIntegrationsView());
  }),
);
// Connect WhatsApp (Social Inbox): finishes Meta's Embedded Signup and saves the number, token and account id.
settingsRouter.post(
  "/integrations/whatsapp/connect", requireAdmin, requirePermission("settings.manage"), validate(whatsAppConnectSchema),
  asyncHandler(async (req, res) => {
    const { phoneNumber, warnings } = await connectWhatsApp(req.body, req.admin?.adminId ?? null);
    res.locals.auditHandled = true;
    recordAudit({
      adminId: req.admin?.adminId ?? null,
      action: "settings.integrations_update",
      entityType: "settings",
      entityId: "integrations",
      ipAddress: req.ip ?? null,
      metadata: { keys: ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_WABA_ID"], whatsappConnect: { coexistence: req.body.coexistence } },
    });
    res.json({ view: getIntegrationsView(), phoneNumber, warnings });
  }),
);
// Import past chats (Social Inbox): queues a background copy of recent Messenger / Instagram conversations.
settingsRouter.post(
  "/integrations/meta/import-history", requireAdmin, requirePermission("settings.manage"), validate(metaHistoryImportSchema),
  asyncHandler(async (req, res) => {
    await requestPastChatsImport(req.body.days);
    res.status(202).json({ queued: true });
  }),
);
settingsRouter.post(
  "/integrations/webpush/generate-keys", requireAdmin, requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const keys = await generateWebPushKeys(req.admin?.adminId ?? null);
    res.locals.auditHandled = true;
    recordAudit({ adminId: req.admin?.adminId ?? null, action: "settings.integrations_update", entityType: "settings", entityId: "integrations", ipAddress: req.ip ?? null, metadata: { keys, generated: true } });
    res.json(getIntegrationsView());
  }),
);

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
