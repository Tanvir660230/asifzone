import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as bundleService from "./bundle.service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json(await bundleService.listBundles(req.query as never));
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  res.json({ bundle: await bundleService.getBundleById(req.params.id!) });
});

export const forProduct = asyncHandler(async (req: Request, res: Response) => {
  res.json({ result: await bundleService.getBundleForProduct(req.params.productId!) });
});

export const preview = asyncHandler(async (req: Request, res: Response) => {
  res.json(await bundleService.getBundleCartPreview(req.body.items));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const bundle = await bundleService.createBundle(req.body);
  res.status(201).json({ bundle });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  res.json({ bundle: await bundleService.updateBundle(req.params.id!, req.body) });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await bundleService.deleteBundle(req.params.id!);
  res.status(204).send();
});
