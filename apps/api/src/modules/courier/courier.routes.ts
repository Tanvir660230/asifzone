import { Router } from "express";
import { courierWebhookRateLimit } from "../../middlewares/rate-limit";
import { requireAdmin } from "../../middlewares/require-admin";
import * as courierController from "./courier.controller";

export const courierRouter = Router();

courierRouter.post("/steadfast/webhook", courierWebhookRateLimit, courierController.webhook);
courierRouter.get("/steadfast/balance", requireAdmin, courierController.balance);
