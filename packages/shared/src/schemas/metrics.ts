import { z } from "zod";
import { METRIC_PRESETS } from "../metrics/business-time";
import { METRIC_GROUPINGS } from "../metrics/registry";

const businessDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD");

/** GET /api/metrics (docs/METRICS_REGISTRY.md §5): registry keys + a preset or an inclusive from/to (business dates).
 * No free-form filters or SQL fragments. */
export const metricsQuerySchema = z
  .object({
    metrics: z
      .string()
      .min(1)
      .max(1000)
      .transform((s) => s.split(",").map((k) => k.trim()).filter(Boolean)),
    preset: z.enum(METRIC_PRESETS).optional(),
    from: businessDateSchema.optional(),
    to: businessDateSchema.optional(),
    groupBy: z.enum(METRIC_GROUPINGS as [string, ...string[]]).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    compare: z.enum(["previous"]).optional(),
  })
  .refine((q) => !(q.preset && (q.from || q.to)), { message: "Use either a preset or from/to, not both" });

export type MetricsQuery = z.infer<typeof metricsQuerySchema>;

export const metricsRangeQuerySchema = z
  .object({
    preset: z.enum(METRIC_PRESETS).optional(),
    from: businessDateSchema.optional(),
    to: businessDateSchema.optional(),
  })
  .refine((q) => !(q.preset && (q.from || q.to)), { message: "Use either a preset or from/to, not both" });
