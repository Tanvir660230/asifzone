import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as smsTemplateService from "./sms-template.service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ templates: await smsTemplateService.listSmsTemplates() });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ template: await smsTemplateService.createSmsTemplate(req.body) });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  res.json({ template: await smsTemplateService.updateSmsTemplate(req.params.id!, req.body) });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await smsTemplateService.deleteSmsTemplate(req.params.id!);
  res.status(204).send();
});
