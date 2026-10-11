import { Router } from "express";
import { aiChatSchema, businessDate, generateAiContentSchema, generateImageAltTextSchema } from "@clothing-brand/shared";
import { asyncHandler } from "../../lib/async-handler";
import { runAssistant } from "../../domain/ai/chat.service";
import { cancelProposal, executeProposal } from "../../domain/ai/proposals.service";
import { storeContext } from "../../domain/metrics/store-time";
import { getSettings } from "../settings/settings.service";
import { anthropicAssistantModel } from "./ai.service";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import { aiRateLimit } from "../../middlewares/rate-limit";
import * as aiController from "./ai.controller";

export const aiRouter = Router();

aiRouter.use(requireAdmin);
// Read-only, zero-cost — any admin can check whether AI is configured.
aiRouter.get("/status", requirePermission("catalog.read"), aiController.status);
// Every call below here bills the store's Anthropic API usage — OWNER-only and rate-limited so a
// compromised staff session or a buggy retry loop can't run up an unbounded cost.
aiRouter.post(
  "/generate", requirePermission("ai.use"),
  aiRateLimit,
  validate(generateAiContentSchema),
  aiController.generate,
);
aiRouter.post(
  "/image-alt-text", requirePermission("ai.use"),
  aiRateLimit,
  validate(generateImageAltTextSchema),
  aiController.generateImageAlt,
);

// The assistant (Blueprint V2 §T, DR-23): read tools answer at once; a change only ever comes back as a proposal.
// These handlers write their own, more specific audit rows (ai.propose / ai.execute / ai.refuse / ai.cancel).
aiRouter.post(
  "/chat", requirePermission("ai.use"),
  aiRateLimit,
  validate(aiChatSchema),
  asyncHandler(async (req, res) => {
    res.locals.auditHandled = true;
    const [settings, { timezone }] = await Promise.all([getSettings(), storeContext()]);
    res.json(await runAssistant(req.admin!, req.body, anthropicAssistantModel(), { storeName: settings.storeName, today: businessDate(new Date(), timezone) }));
  }),
);
/** Confirm a proposal — the change runs as this admin, through the same command a person uses. */
aiRouter.post(
  "/proposals/:id/execute", requirePermission("ai.execute"),
  asyncHandler(async (req, res) => {
    res.locals.auditHandled = true;
    res.json(await executeProposal(req.admin!, req.params.id!));
  }),
);
aiRouter.post(
  "/proposals/:id/cancel", requirePermission("ai.use"),
  asyncHandler(async (req, res) => {
    res.locals.auditHandled = true;
    res.json(await cancelProposal(req.admin!, req.params.id!));
  }),
);
