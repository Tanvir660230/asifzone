import { z } from "zod";
import { paginationQuerySchema } from "./common";
import type { ReplyWindow } from "../reply-window";

export const CONVERSATION_CHANNELS = ["WEB_FORM", "EMAIL", "SMS", "WHATSAPP", "MESSENGER", "INSTAGRAM", "FB_COMMENT"] as const;
export type ConversationChannelName = (typeof CONVERSATION_CHANNELS)[number];

/** Admin V2 Inbox R2 (DR-4): conversation list filters. */
export const conversationListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["open", "handled", "all"]).default("open"),
  /** Only the conversations assigned to the admin asking. */
  mine: z.enum(["true"]).optional(),
  search: z.string().trim().max(120).optional(),
  channel: z.enum(CONVERSATION_CHANNELS).optional(),
});
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

/** The channels a reply can go out on. On a FB_COMMENT thread, MESSENGER means a private reply to the comment. */
export const REPLY_CHANNELS = ["EMAIL", "SMS", "WHATSAPP", "MESSENGER", "INSTAGRAM", "FB_COMMENT"] as const;
export type ReplyChannel = (typeof REPLY_CHANNELS)[number];

/** A reply typed in the Store Console — by email, SMS, or on the social channel the customer wrote from. */
export const conversationReplySchema = z
  .object({ channel: z.enum(REPLY_CHANNELS), body: z.string().trim().min(1, "Write a reply").max(2000) })
  .refine((r) => r.channel !== "SMS" || r.body.length <= 600, { path: ["body"], message: "An SMS reply can be at most 600 characters" });
export type ConversationReplyInput = z.infer<typeof conversationReplySchema>;

/** Handled ↔ new, and/or take it (assignedToMe: true) or let it go (false). At least one. */
export const updateConversationSchema = z
  .object({ status: z.enum(["OPEN", "HANDLED"]).optional(), assignedToMe: z.boolean().optional() })
  .refine((v) => v.status !== undefined || v.assignedToMe !== undefined, { message: "Nothing to change" });

/** Who wrote a message: the customer, staff in the Inbox, the AI, or staff replying from the phone app / Page inbox. */
export type MessageAuthor = "CUSTOMER" | "STAFF" | "AI" | "PHONE";
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
  author: MessageAuthor;
  /** The admin who wrote an OUT message. */
  by: string | null;
  delivery: MessageDelivery | null;
  deliveryError: string | null;
}

export interface ConversationDetail extends Omit<ConversationListRow, "preview" | "messageCount"> {
  createdAt: string;
  customer: { id: string; name: string } | null;
  messages: ConversationMessageRow[];
  /** The AI's suggested reply to the latest message, waiting for staff. */
  draft: { body: string; intent: string } | null;
  replyWindow: ReplyWindow;
  /** Where a reply can go (shared replyChannelsFor). */
  replyChannels: ReplyChannel[];
}
