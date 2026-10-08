import { Router } from "express";
import { conversationListQuerySchema, conversationReplySchema, updateConversationSchema, type ConversationListQuery } from "@clothing-brand/shared";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import { asyncHandler } from "../../lib/async-handler";
import { deleteConversation, getConversation, listConversations, replyToConversation, updateConversation } from "./inbox.service";

/** /api/v1/admin/conversations — Messages › Inbox (R2). Reading and triage: content.manage (as the contact form was);
 * replying to a customer: customers.message. */
export const inboxRouter = Router();
inboxRouter.use(requireAdmin);

inboxRouter.get(
  "/", requirePermission("content.manage"), validate(conversationListQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    res.json(await listConversations(req.query as unknown as ConversationListQuery, req.admin!.adminId));
  }),
);
inboxRouter.get(
  "/:id", requirePermission("content.manage"),
  asyncHandler(async (req, res) => {
    res.json(await getConversation(req.params.id!));
  }),
);
inboxRouter.patch(
  "/:id", requirePermission("content.manage"), validate(updateConversationSchema),
  asyncHandler(async (req, res) => {
    res.json(await updateConversation(req.params.id!, req.body, req.admin!.adminId));
  }),
);
inboxRouter.delete(
  "/:id", requirePermission("content.manage"),
  asyncHandler(async (req, res) => {
    await deleteConversation(req.params.id!);
    res.status(204).send();
  }),
);
inboxRouter.post(
  "/:id/replies", requirePermission("customers.message"), validate(conversationReplySchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await replyToConversation(req.params.id!, req.body, req.admin!.adminId));
  }),
);
