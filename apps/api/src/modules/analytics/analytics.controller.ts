import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as analyticsService from "./analytics.service";

export const summary = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await analyticsService.getDashboardSummary());
});

export const revenueSeries = asyncHandler(async (req: Request, res: Response) => {
  const days = Number(req.query.days) || 30;
  res.json({ series: await analyticsService.getRevenueSeries(days) });
});

export const orderStatusCounts = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ counts: await analyticsService.getOrderStatusCounts() });
});

export const topProducts = asyncHandler(async (req: Request, res: Response) => {
  const days = Number(req.query.days) || 30;
  const limit = Number(req.query.limit) || 5;
  res.json({ products: await analyticsService.getTopProducts(days, limit) });
});

export const lowStock = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ variants: await analyticsService.getLowStockVariants() });
});
