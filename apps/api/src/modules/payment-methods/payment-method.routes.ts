import { Router } from "express";
import { createPaymentMethodSchema, updatePaymentMethodSchema, reorderPaymentMethodsSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { imageUpload } from "../uploads/upload.middleware";
import * as paymentMethodController from "./payment-method.controller";

export const paymentMethodRouter = Router();

paymentMethodRouter.get("/active", paymentMethodController.active);

paymentMethodRouter.get("/", requireAdmin, requirePermission("content.manage"), paymentMethodController.list);
paymentMethodRouter.post("/upload-logo", requireAdmin, requirePermission("content.manage"), imageUpload.single("image"), paymentMethodController.uploadLogo);
paymentMethodRouter.post("/", requireAdmin, requirePermission("content.manage"), validate(createPaymentMethodSchema), paymentMethodController.create);
paymentMethodRouter.post("/reorder", requireAdmin, requirePermission("content.manage"), validate(reorderPaymentMethodsSchema), paymentMethodController.reorder);
paymentMethodRouter.patch("/:id", requireAdmin, requirePermission("content.manage"), validate(updatePaymentMethodSchema), paymentMethodController.update);
paymentMethodRouter.delete("/:id", requireAdmin, requirePermission("content.manage"), paymentMethodController.remove);
