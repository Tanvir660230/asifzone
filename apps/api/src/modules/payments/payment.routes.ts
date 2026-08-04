import { Router } from "express";
import * as paymentController from "./payment.controller";

export const paymentRouter = Router();

paymentRouter.post("/sslcommerz/success", paymentController.success);
paymentRouter.post("/sslcommerz/fail", paymentController.fail);
paymentRouter.post("/sslcommerz/cancel", paymentController.cancel);
paymentRouter.post("/sslcommerz/ipn", paymentController.ipn);
