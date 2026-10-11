import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as notificationService from "./notification.service";

// Every route is requireSelf: read state and visibility are the calling admin's own (DR-15).
export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json(await notificationService.listNotifications(req.admin!));
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  await notificationService.markNotificationRead(req.admin!, req.params.id!);
  res.status(204).send();
});

export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  await notificationService.markAllNotificationsRead(req.admin!);
  res.status(204).send();
});
