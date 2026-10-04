import { Router } from "express";
import { requireAdmin, requireSelf } from "../../middlewares/require-admin";
import * as notificationController from "./notification.controller";

export const notificationRouter = Router();

notificationRouter.use(requireAdmin);
notificationRouter.get("/", requireSelf, notificationController.list);
notificationRouter.post("/:id/read", requireSelf, notificationController.markRead);
notificationRouter.post("/read-all", requireSelf, notificationController.markAllRead);
