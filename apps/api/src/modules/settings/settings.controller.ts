import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { processLogoImage, processFaviconImage, processPaymentMethodsImage } from "../uploads/upload.service";
import * as settingsService from "./settings.service";

export const get = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ settings: await settingsService.getSettings() });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  res.json({ settings: await settingsService.updateSettings(req.body) });
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

export const uploadPaymentMethodsImage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No image file provided" });
    return;
  }
  const url = await processPaymentMethodsImage(req.file.buffer);
  res.status(201).json({ url });
});
