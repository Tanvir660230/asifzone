import { Router } from "express";
import { requireAdmin } from "../../middlewares/require-admin";
import * as analyticsController from "./analytics.controller";

export const analyticsRouter = Router();

analyticsRouter.use(requireAdmin);
analyticsRouter.get("/summary", analyticsController.summary);
analyticsRouter.get("/revenue", analyticsController.revenueSeries);
analyticsRouter.get("/order-status", analyticsController.orderStatusCounts);
analyticsRouter.get("/top-products", analyticsController.topProducts);
analyticsRouter.get("/low-stock", analyticsController.lowStock);
