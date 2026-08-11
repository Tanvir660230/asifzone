import { Router } from "express";
import { courierWebhookRateLimit } from "../../middlewares/rate-limit";
import * as courierController from "./courier.controller";

export const courierRouter = Router();

courierRouter.post("/steadfast/webhook", courierWebhookRateLimit, courierController.webhook);
