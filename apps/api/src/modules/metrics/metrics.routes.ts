import { Router } from "express";
import { metricsQuerySchema, metricsRangeQuerySchema } from "@clothing-brand/shared";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import * as metricsController from "./metrics.controller";

/** The reusable metrics API (docs/METRICS_REGISTRY.md §5) — every business number, one definition each. */
export const metricsRouter = Router();

metricsRouter.use(requireAdmin);
metricsRouter.get("/", requirePermission("analytics.read"), validate(metricsQuerySchema, "query"), metricsController.metrics);
metricsRouter.get("/definitions", requirePermission("analytics.read"), metricsController.definitions);
metricsRouter.get("/consistency", requirePermission("ops.read"), validate(metricsRangeQuerySchema, "query"), metricsController.consistency);
