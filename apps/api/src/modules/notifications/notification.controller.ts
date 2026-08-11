import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as notificationService from "./notification.service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await notificationService.listNotifications());
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  await notificationService.markNotificationRead(req.params.id!);
  res.status(204).send();
});

export const markAllRead = asyncHandler(async (_req: Request, res: Response) => {
  await notificationService.markAllNotificationsRead();
  res.status(204).send();
});
