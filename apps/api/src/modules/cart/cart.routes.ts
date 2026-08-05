import { Router } from "express";
import { syncCartSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireCustomer } from "../../middlewares/require-customer";
import * as cartController from "./cart.controller";

export const cartRouter = Router();

cartRouter.use(requireCustomer);
cartRouter.put("/", validate(syncCartSchema), cartController.sync);
