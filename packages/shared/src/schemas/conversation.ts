import { z } from "zod";
import { paginationQuerySchema } from "./common";

/** Admin V2 Inbox R2 (DR-4): conversation list filters. */
export const conversationListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["open", "handled", "all"]).default("open"),
  /** Only the conversations assigned to the admin asking. */
  mine: z.enum(["true"]).optional(),
  search: z.string().trim().max(120).optional(),
});
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

/** A reply typed in the Store Console, sent by email or SMS. */
export const conversationReplySchema = z
  .object({ channel: z.enum(["EMAIL", "SMS"]), body: z.string().trim().min(1, "Write a reply").max(2000) })
  .refine((r) => r.channel !== "SMS" || r.body.length <= 600, { path: ["body"], message: "An SMS reply can be at most 600 characters" });
export type ConversationReplyInput = z.infer<typeof conversationReplySchema>;

/** Handled ↔ new, and/or take it (assignedToMe: true) or let it go (false). At least one. */
export const updateConversationSchema = z
  .object({ status: z.enum(["OPEN", "HANDLED"]).optional(), assignedToMe: z.boolean().optional() })
  .refine((v) => v.status !== undefined || v.assignedToMe !== undefined, { message: "Nothing to change" });

export type ConversationChannelName = "WEB_FORM" | "EMAIL" | "SMS" | "WHATSAPP" | "MESSENGER";
/** An OUT message's delivery, read from its outbox row. */
export type MessageDelivery = "sending" | "sent" | "failed";

export interface ConversationListRow {
  id: string;
  channel: ConversationChannelName;
  subject: string;
  contactName: string;
  email: string | null;
  phone: string | null;
  status: "OPEN" | "HANDLED";
  lastMessageAt: string;
  /** The latest message's first line, for the list. */
  preview: string;
  messageCount: number;
  assignedTo: { id: string; name: string } | null;
}

export interface ConversationMessageRow {
  id: string;
  direction: "IN" | "OUT";
  channel: ConversationChannelName;
  body: string;
  createdAt: string;
  /** The admin who wrote an OUT message. */
  by: string | null;
  delivery: MessageDelivery | null;
  deliveryError: string | null;
}

export interface ConversationDetail extends Omit<ConversationListRow, "preview" | "messageCount"> {
  createdAt: string;
  customer: { id: string; name: string } | null;
  messages: ConversationMessageRow[];
}
