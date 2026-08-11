import type { Request, Response } from "express";
import type { TrackPageViewInput, AnalyticsQuery } from "@clothing-brand/shared";
import { asyncHandler } from "../../lib/async-handler";
import * as analyticsService from "./analytics.service";

// req.query has already been through analyticsQuerySchema (see analytics.routes.ts) by the time
// any handler below runs — coerced to numbers and bounded (days: 1-365, limit: 1-100) — so this
// is just picking the per-endpoint default for whichever field the caller left out.
function query(req: Request): AnalyticsQuery {
  return req.query as unknown as AnalyticsQuery;
}

export const summary = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await analyticsService.getDashboardSummary());
});

export const revenueSeries = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30 } = query(req);
  res.json({ series: await analyticsService.getRevenueSeries(days) });
});

export const orderStatusCounts = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ counts: await analyticsService.getOrderStatusCounts() });
});

export const topProducts = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30, limit = 5 } = query(req);
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
  const { days = 30, limit = 10 } = query(req);
  res.json({ products: await analyticsService.getMostViewedProducts(days, limit) });
});

export const searchAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30, limit = 10 } = query(req);
  res.json(await analyticsService.getSearchAnalytics(days, limit));
});

export const cartAbandonment = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await analyticsService.getCartAbandonmentSummary());
});

export const customerInsights = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await analyticsService.getCustomerInsights());
});

export const topCategories = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30, limit = 10 } = query(req);
  res.json({ categories: await analyticsService.getTopCategories(days, limit) });
});

export const topBrands = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30, limit = 10 } = query(req);
  res.json({ brands: await analyticsService.getTopBrands(days, limit) });
});

export const conversionFunnel = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30 } = query(req);
  res.json(await analyticsService.getConversionFunnel(days));
});

export const trafficSources = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30, limit = 10 } = query(req);
  res.json({ sources: await analyticsService.getTrafficSources(days, limit) });
});

export const campaignPerformance = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30, limit = 10 } = query(req);
  res.json({ campaigns: await analyticsService.getCampaignPerformance(days, limit) });
});

export const slowMovingProducts = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30, limit = 10 } = query(req);
  res.json({ products: await analyticsService.getSlowMovingProducts(days, limit) });
});

export const bestSellingPrediction = asyncHandler(async (req: Request, res: Response) => {
  const { limit = 10 } = query(req);
  res.json({ products: await analyticsService.getBestSellingPrediction(limit) });
});

export const demandForecast = asyncHandler(async (req: Request, res: Response) => {
  const { days = 14, limit = 10 } = query(req);
  res.json({ variants: await analyticsService.getDemandForecast(days, limit) });
});
