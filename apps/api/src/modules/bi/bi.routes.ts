import { Router } from "express";
import { requireAdmin } from "../../middlewares/require-admin";
import * as biController from "./bi.controller";

export const biRouter = Router();

biRouter.use(requireAdmin);
biRouter.get("/overview", biController.overview);
biRouter.get("/automated-insights", biController.automatedInsights);
