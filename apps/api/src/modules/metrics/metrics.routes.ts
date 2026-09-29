import { Router } from "express";
import { metricsQuerySchema, metricsRangeQuerySchema } from "@clothing-brand/shared";
import { requireAdmin } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import * as metricsController from "./metrics.controller";

/** The reusable metrics API (docs/METRICS_REGISTRY.md §5) — every business number, one definition each. */
export const metricsRouter = Router();

metricsRouter.use(requireAdmin);
metricsRouter.get("/", validate(metricsQuerySchema, "query"), metricsController.metrics);
metricsRouter.get("/definitions", metricsController.definitions);
metricsRouter.get("/consistency", validate(metricsRangeQuerySchema, "query"), metricsController.consistency);
