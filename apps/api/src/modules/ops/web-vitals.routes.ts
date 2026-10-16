import { Router } from "express";
import { z } from "zod";
import { DEVICE_KINDS, PAGE_KINDS, WEB_VITAL_METRICS } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { clientReportRateLimit } from "../../middlewares/rate-limit";
import { asyncHandler } from "../../lib/async-handler";
import { recordVitalSamples } from "./web-vitals.service";

/** Site health: POST /api/v1/vitals — Core Web Vitals from real storefront visits (apps/web
 * components/analytics/web-vitals-reporter.tsx). Public beacon, same trust model as /api/v1/client-errors: bounded,
 * rate-limited, anonymous, replies 204. Bots and lab tools (Lighthouse, headless browsers) are skipped silently so the
 * numbers describe customers. The admin summary is GET /api/v1/ops/vitals (ops.routes.ts). */

const NOT_A_VISITOR = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|pingdom|playwright|puppeteer/i;

const sampleSchema = z
  .object({
    metric: z.enum(WEB_VITAL_METRICS),
    value: z.number().finite().min(0).max(60_000),
    pageKind: z.enum(PAGE_KINDS),
    device: z.enum(DEVICE_KINDS),
  })
  .refine((s) => s.metric !== "CLS" || s.value <= 10, { message: "CLS out of range", path: ["value"] });

const vitalsSchema = z.object({ samples: z.array(sampleSchema).min(1).max(10) });

export const vitalsRouter = Router();
vitalsRouter.post(
  "/",
  clientReportRateLimit,
  validate(vitalsSchema),
  asyncHandler(async (req, res) => {
    if (!NOT_A_VISITOR.test(req.get("user-agent") ?? "")) {
      await recordVitalSamples((req.body as z.infer<typeof vitalsSchema>).samples);
    }
    res.status(204).end();
  }),
);
