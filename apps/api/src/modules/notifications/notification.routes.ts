import { Router } from "express";
import { requireAdmin } from "../../middlewares/require-admin";
import * as notificationController from "./notification.controller";

export const notificationRouter = Router();

notificationRouter.use(requireAdmin);
notificationRouter.get("/", notificationController.list);
notificationRouter.post("/:id/read", notificationController.markRead);
notificationRouter.post("/read-all", notificationController.markAllRead);
