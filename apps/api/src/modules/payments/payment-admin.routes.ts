import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import * as paymentAdminController from "./payment-admin.controller";

const searchQuerySchema = z.object({ phone: z.string().min(4).max(20) });

export const paymentAdminRouter = Router();

paymentAdminRouter.use(requireAdmin);
paymentAdminRouter.get("/overview", paymentAdminController.overview);
paymentAdminRouter.get("/search", validate(searchQuerySchema, "query"), paymentAdminController.search);
