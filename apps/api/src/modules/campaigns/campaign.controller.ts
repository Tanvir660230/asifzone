import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as campaignService from "./campaign.service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json(await campaignService.listCampaigns(req.query as never));
});

/** The audience preview: counts only (never the customers themselves). */
export const audience = asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as unknown as { segmentType: Parameters<typeof campaignService.campaignAudience>[0]; channel: "EMAIL" | "SMS" | "PUSH" };
  const { customers, reachable } = await campaignService.campaignAudience(q.segmentType, q.channel);
  res.json({ customers, reachable });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  res.json({ campaign: await campaignService.getCampaignById(req.params.id!) });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const campaign = await campaignService.createCampaign(req.body);
  res.status(201).json({ campaign });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  res.json({ campaign: await campaignService.updateCampaign(req.params.id!, req.body) });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await campaignService.deleteCampaign(req.params.id!);
  res.status(204).send();
});

export const schedule = asyncHandler(async (req: Request, res: Response) => {
  res.json({ campaign: await campaignService.scheduleCampaign(req.params.id!, req.body.scheduledAt) });
});

export const cancelSchedule = asyncHandler(async (req: Request, res: Response) => {
  res.json({ campaign: await campaignService.cancelSchedule(req.params.id!) });
});

export const sendNow = asyncHandler(async (req: Request, res: Response) => {
  await campaignService.queueCampaignSend(req.params.id!);
  res.json({ campaign: await campaignService.getCampaignById(req.params.id!) });
});
