import { Router } from "express";
import { paymentCallbackRateLimit } from "../../middlewares/rate-limit";
import * as paymentController from "./payment.controller";

export const paymentRouter = Router();

paymentRouter.post("/sslcommerz/success", paymentCallbackRateLimit, paymentController.success);
paymentRouter.post("/sslcommerz/fail", paymentCallbackRateLimit, paymentController.fail);
paymentRouter.post("/sslcommerz/cancel", paymentCallbackRateLimit, paymentController.cancel);
paymentRouter.post("/sslcommerz/ipn", paymentCallbackRateLimit, paymentController.ipn);

// EPS-PG redirects the browser back with a GET, not a POST — see payment.controller.ts's epsSuccess.
paymentRouter.get("/eps/success", paymentCallbackRateLimit, paymentController.epsSuccess);
paymentRouter.get("/eps/fail", paymentCallbackRateLimit, paymentController.epsFail);
paymentRouter.get("/eps/cancel", paymentCallbackRateLimit, paymentController.epsCancel);
