import { Router } from "express";
import { createPaymentMethodSchema, updatePaymentMethodSchema, reorderPaymentMethodsSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
import { imageUpload } from "../uploads/upload.middleware";
import * as paymentMethodController from "./payment-method.controller";

export const paymentMethodRouter = Router();

paymentMethodRouter.get("/active", paymentMethodController.active);

paymentMethodRouter.get("/", requireAdmin, paymentMethodController.list);
paymentMethodRouter.post("/upload-logo", requireAdmin, imageUpload.single("image"), paymentMethodController.uploadLogo);
paymentMethodRouter.post("/", requireAdmin, validate(createPaymentMethodSchema), paymentMethodController.create);
paymentMethodRouter.post("/reorder", requireAdmin, validate(reorderPaymentMethodsSchema), paymentMethodController.reorder);
paymentMethodRouter.patch("/:id", requireAdmin, validate(updatePaymentMethodSchema), paymentMethodController.update);
paymentMethodRouter.delete("/:id", requireAdmin, paymentMethodController.remove);
