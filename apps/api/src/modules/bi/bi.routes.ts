import { Router } from "express";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import * as biController from "./bi.controller";

export const biRouter = Router();

biRouter.use(requireAdmin);
biRouter.get("/overview", requirePermission("analytics.read"), biController.overview);
biRouter.get("/automated-insights", requirePermission("analytics.read"), biController.automatedInsights);
