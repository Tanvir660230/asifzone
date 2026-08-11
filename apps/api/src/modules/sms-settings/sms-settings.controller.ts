import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as smsSettingsService from "./sms-settings.service";

export const get = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ settings: await smsSettingsService.getSmsSettings() });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  res.json({ settings: await smsSettingsService.updateSmsSettings(req.body) });
});
