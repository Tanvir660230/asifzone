import { Router } from "express";
import {
  campaignAudienceQuerySchema,
  createCampaignSchema,
  updateCampaignSchema,
  campaignListQuerySchema,
  scheduleCampaignSchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import * as campaignController from "./campaign.controller";

export const campaignRouter = Router();

campaignRouter.use(requireAdmin);

campaignRouter.get("/", requirePermission("campaigns.manage"), validate(campaignListQuerySchema, "query"), campaignController.list);
// Before "/:id": how many a segment holds and how many the channel can reach.
campaignRouter.get("/audience", requirePermission("campaigns.manage"), validate(campaignAudienceQuerySchema, "query"), campaignController.audience);
campaignRouter.get("/:id", requirePermission("campaigns.manage"), campaignController.getOne);
campaignRouter.post("/", requirePermission("campaigns.manage"), validate(createCampaignSchema), campaignController.create);
campaignRouter.patch("/:id", requirePermission("campaigns.manage"), validate(updateCampaignSchema), campaignController.update);
campaignRouter.delete("/:id", requirePermission("campaigns.manage"), campaignController.remove);

campaignRouter.post("/:id/schedule", requirePermission("campaigns.manage"), validate(scheduleCampaignSchema), campaignController.schedule);
campaignRouter.post("/:id/cancel-schedule", requirePermission("campaigns.manage"), campaignController.cancelSchedule);
campaignRouter.post("/:id/send", requirePermission("campaigns.manage"), campaignController.sendNow);
