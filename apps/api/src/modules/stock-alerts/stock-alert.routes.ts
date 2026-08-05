import { Router } from "express";
import { createStockAlertSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireCustomer } from "../../middlewares/require-customer";
import * as stockAlertController from "./stock-alert.controller";

export const stockAlertRouter = Router();

stockAlertRouter.use(requireCustomer);
stockAlertRouter.post("/", validate(createStockAlertSchema), stockAlertController.subscribe);
stockAlertRouter.delete("/:variantId", stockAlertController.unsubscribe);
