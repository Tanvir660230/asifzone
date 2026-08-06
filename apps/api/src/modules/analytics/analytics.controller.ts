import type { Request, Response } from "express";
import type { TrackPageViewInput } from "@clothing-brand/shared";
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

export const trackPageView = asyncHandler(async (req: Request, res: Response) => {
  await analyticsService.trackPageView(req.body as TrackPageViewInput);
  res.status(204).end();
});

export const mostViewedProducts = asyncHandler(async (req: Request, res: Response) => {
  const days = Number(req.query.days) || 30;
  const limit = Number(req.query.limit) || 10;
  res.json({ products: await analyticsService.getMostViewedProducts(days, limit) });
});

export const searchAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const days = Number(req.query.days) || 30;
  const limit = Number(req.query.limit) || 10;
  res.json(await analyticsService.getSearchAnalytics(days, limit));
});

export const cartAbandonment = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await analyticsService.getCartAbandonmentSummary());
});

export const customerInsights = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await analyticsService.getCustomerInsights());
});

export const topCategories = asyncHandler(async (req: Request, res: Response) => {
  const days = Number(req.query.days) || 30;
  const limit = Number(req.query.limit) || 10;
  res.json({ categories: await analyticsService.getTopCategories(days, limit) });
});

export const topBrands = asyncHandler(async (req: Request, res: Response) => {
  const days = Number(req.query.days) || 30;
  const limit = Number(req.query.limit) || 10;
  res.json({ brands: await analyticsService.getTopBrands(days, limit) });
});

export const conversionFunnel = asyncHandler(async (req: Request, res: Response) => {
  const days = Number(req.query.days) || 30;
  res.json(await analyticsService.getConversionFunnel(days));
});

export const trafficSources = asyncHandler(async (req: Request, res: Response) => {
  const days = Number(req.query.days) || 30;
  const limit = Number(req.query.limit) || 10;
  res.json({ sources: await analyticsService.getTrafficSources(days, limit) });
});

export const campaignPerformance = asyncHandler(async (req: Request, res: Response) => {
  const days = Number(req.query.days) || 30;
  const limit = Number(req.query.limit) || 10;
  res.json({ campaigns: await analyticsService.getCampaignPerformance(days, limit) });
});

export const slowMovingProducts = asyncHandler(async (req: Request, res: Response) => {
  const days = Number(req.query.days) || 30;
  const limit = Number(req.query.limit) || 10;
  res.json({ products: await analyticsService.getSlowMovingProducts(days, limit) });
});

export const bestSellingPrediction = asyncHandler(async (req: Request, res: Response) => {
  const limit = Number(req.query.limit) || 10;
  res.json({ products: await analyticsService.getBestSellingPrediction(limit) });
});

export const demandForecast = asyncHandler(async (req: Request, res: Response) => {
  const days = Number(req.query.days) || 14;
  const limit = Number(req.query.limit) || 10;
  res.json({ variants: await analyticsService.getDemandForecast(days, limit) });
});
