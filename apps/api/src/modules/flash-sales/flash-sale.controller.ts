import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as flashSaleService from "./flash-sale.service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ flashSales: await flashSaleService.listFlashSales() });
});

export const active = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ flashSale: await flashSaleService.getActiveFlashSaleForHomepage() });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  res.json({ flashSale: await flashSaleService.getFlashSaleById(req.params.id!) });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const flashSale = await flashSaleService.createFlashSale(req.body);
  res.status(201).json({ flashSale });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  res.json({ flashSale: await flashSaleService.updateFlashSale(req.params.id!, req.body) });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await flashSaleService.deleteFlashSale(req.params.id!);
  res.status(204).send();
});

export const addItem = asyncHandler(async (req: Request, res: Response) => {
  const flashSale = await flashSaleService.addFlashSaleItem(req.params.id!, req.body);
  res.status(201).json({ flashSale });
});

export const removeItem = asyncHandler(async (req: Request, res: Response) => {
  const flashSale = await flashSaleService.removeFlashSaleItem(req.params.id!, req.params.itemId!);
  res.json({ flashSale });
});
