import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as socialLinkService from "./social-link.service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ links: await socialLinkService.listSocialLinks() });
});

export const active = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ links: await socialLinkService.getActiveSocialLinks() });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const link = await socialLinkService.createSocialLink(req.body);
  res.status(201).json({ link });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  res.json({ link: await socialLinkService.updateSocialLink(req.params.id!, req.body) });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await socialLinkService.deleteSocialLink(req.params.id!);
  res.status(204).send();
});
