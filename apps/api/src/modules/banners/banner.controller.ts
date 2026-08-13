import type { Request, Response } from "express";
import type { ActiveBannersQuery } from "@clothing-brand/shared";
import { asyncHandler } from "../../lib/async-handler";
import { processBannerImage } from "../uploads/upload.service";
import * as bannerService from "./banner.service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ banners: await bannerService.listBanners() });
});

export const active = asyncHandler(async (req: Request, res: Response) => {
  const { placement } = req.query as unknown as ActiveBannersQuery;
  res.json({ banners: await bannerService.getActiveBanners(placement) });
});

export const uploadImage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No image file provided" });
    return;
  }
  const url = await processBannerImage(req.file.buffer);
  res.status(201).json({ url });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const banner = await bannerService.createBanner(req.body);
  res.status(201).json({ banner });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  res.json({ banner: await bannerService.updateBanner(req.params.id!, req.body) });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await bannerService.deleteBanner(req.params.id!);
  res.status(204).send();
});

export const reorder = asyncHandler(async (req: Request, res: Response) => {
  res.json({ banners: await bannerService.reorderBanners(req.body.ids) });
});
