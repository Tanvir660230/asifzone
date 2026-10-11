import type { Request, Response } from "express";
import { METRIC_DEFINITIONS, type MetricGrouping, type MetricsQuery } from "@clothing-brand/shared";
import { asyncHandler } from "../../lib/async-handler";
import { computeMetrics } from "../../domain/metrics/metrics.service";
import { metricsConsistency } from "../../domain/metrics/consistency.service";

type RangeQuery = Pick<MetricsQuery, "preset" | "from" | "to">;
const rangeOf = (q: RangeQuery) => (q.from || q.to ? { from: q.from, to: q.to } : { preset: q.preset });

export const metrics = asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as unknown as MetricsQuery;
  res.json(await computeMetrics({ metrics: q.metrics, range: rangeOf(q), groupBy: q.groupBy as MetricGrouping | undefined, limit: q.limit, compare: q.compare }));
});

export const definitions = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ metrics: METRIC_DEFINITIONS });
});

export const consistency = asyncHandler(async (req: Request, res: Response) => {
  res.json(await metricsConsistency(rangeOf(req.query as unknown as RangeQuery)));
});
