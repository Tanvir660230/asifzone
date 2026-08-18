import { Router } from "express";
import { requireAdmin } from "../../middlewares/require-admin";
import * as paymentAdminController from "./payment-admin.controller";

export const paymentAdminRouter = Router();

paymentAdminRouter.use(requireAdmin);
paymentAdminRouter.get("/overview", paymentAdminController.overview);
