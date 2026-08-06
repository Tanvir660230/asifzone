import { Router } from "express";
import {
  createCampaignSchema,
  updateCampaignSchema,
  campaignListQuerySchema,
  scheduleCampaignSchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
import * as campaignController from "./campaign.controller";

export const campaignRouter = Router();

campaignRouter.use(requireAdmin);

campaignRouter.get("/", validate(campaignListQuerySchema, "query"), campaignController.list);
campaignRouter.get("/:id", campaignController.getOne);
campaignRouter.post("/", validate(createCampaignSchema), campaignController.create);
campaignRouter.patch("/:id", validate(updateCampaignSchema), campaignController.update);
campaignRouter.delete("/:id", campaignController.remove);

campaignRouter.post("/:id/schedule", validate(scheduleCampaignSchema), campaignController.schedule);
campaignRouter.post("/:id/cancel-schedule", campaignController.cancelSchedule);
campaignRouter.post("/:id/send", campaignController.sendNow);
