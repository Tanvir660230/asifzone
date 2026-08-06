import { Router } from "express";
import { generateAiContentSchema, generateImageAltTextSchema } from "@clothing-brand/shared";
import { requireAdmin, requireRole } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import { aiRateLimit } from "../../middlewares/rate-limit";
import * as aiController from "./ai.controller";

export const aiRouter = Router();

aiRouter.use(requireAdmin);
// Read-only, zero-cost — any admin can check whether AI is configured.
aiRouter.get("/status", aiController.status);
// Every call below here bills the store's Anthropic API usage — OWNER-only and rate-limited so a
// compromised staff session or a buggy retry loop can't run up an unbounded cost.
aiRouter.post(
  "/generate",
  requireRole("OWNER"),
  aiRateLimit,
  validate(generateAiContentSchema),
  aiController.generate,
);
aiRouter.post(
  "/image-alt-text",
  requireRole("OWNER"),
  aiRateLimit,
  validate(generateImageAltTextSchema),
  aiController.generateImageAlt,
);
