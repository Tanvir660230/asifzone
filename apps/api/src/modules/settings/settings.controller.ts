import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { processLogoImage, processFaviconImage, processPaymentMethodsImage, processSocialImage } from "../uploads/upload.service";
import * as settingsService from "./settings.service";
import { loadTaxConfig, pricingConfigDrift } from "../../domain/pricing/pricing-config";
import { capabilities } from "../../providers/registry";

/** StoreSetting plus the one tax field that lives only in the TaxSetting authority (D10), plus (Phase 12 D-4) which online
 * gateways this deployment can actually use — booleans only — so checkout never offers a gateway that cannot work. The
 * store's own toggles (onlinePaymentEnabled / epsPaymentEnabled) are unchanged and still apply on top. */
async function withTaxConfig<T extends object>(settings: T) {
  return { ...settings, shippingTaxable: (await loadTaxConfig()).shippingTaxable, onlineGateways: capabilities().payments };
}

export const get = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ settings: await withTaxConfig(await settingsService.getSettings()) });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  res.json({ settings: await withTaxConfig(await settingsService.updateSettings(req.body)) });
});

export const pricingDrift = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ drift: await pricingConfigDrift() });
});

export const uploadLogo = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No image file provided" });
    return;
  }
  const url = await processLogoImage(req.file.buffer);
  res.status(201).json({ url });
});

export const uploadFavicon = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No image file provided" });
    return;
  }
  const url = await processFaviconImage(req.file.buffer);
  res.status(201).json({ url });
});

export const uploadSocialImage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No image file provided" });
    return;
  }
  const url = await processSocialImage(req.file.buffer);
  res.status(201).json({ url });
});

export const uploadPaymentMethodsImage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No image file provided" });
    return;
  }
  const url = await processPaymentMethodsImage(req.file.buffer);
  res.status(201).json({ url });
});
