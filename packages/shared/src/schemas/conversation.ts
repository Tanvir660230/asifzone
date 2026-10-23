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

/** An approved WhatsApp message template (WhatsApp Manager), as the composer offers it once the 24-hour window closed.
 * `params` are its placeholders in order: "1", "2"… or names ({{order_number}}) when `named`. */
export interface WhatsAppTemplate {
  name: string;
  language: string;
  category: string;
  header: string | null;
  body: string;
  footer: string | null;
  params: string[];
  named: boolean;
}

/** The {{placeholders}} of a template text, in order of first use. */
export function templatePlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!))];
}

/** A template's text with its placeholders filled (an empty value shows as the placeholder itself). */
export function renderTemplate(template: Pick<WhatsAppTemplate, "header" | "body" | "footer" | "params">, values: string[]): string {
  const fill = (text: string) => text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (all, key: string) => values[template.params.indexOf(key)]?.trim() || all);
  return [template.header, fill(template.body), template.footer].filter(Boolean).join("\n\n");
}

export const templateReplySchema = z.object({
  name: z.string().trim().min(1).max(512),
  language: z.string().trim().min(2).max(15),
  params: z.array(z.string().trim().min(1, "Fill in every blank").max(500)).max(20),
});
export type TemplateReplyInput = z.infer<typeof templateReplySchema>;

/** A reply typed in the Store Console — by email, SMS, or on the social channel the customer wrote from. On WhatsApp
 * after the 24-hour window it is an approved template (`template`), and `body` may be left empty. */
export const conversationReplySchema = z
  .object({ channel: z.enum(REPLY_CHANNELS), body: z.string().trim().max(2000).default(""), template: templateReplySchema.optional() })
  .refine((r) => r.template !== undefined || r.body.length > 0, { path: ["body"], message: "Write a reply" })
  .refine((r) => r.template === undefined || r.channel === "WHATSAPP", { path: ["template"], message: "Templates are for WhatsApp only" })
  .refine((r) => r.channel !== "SMS" || r.body.length <= 600, { path: ["body"], message: "An SMS reply can be at most 600 characters" });
export type ConversationReplyInput = z.input<typeof conversationReplySchema>;
/** A validated reply, as the API handles it. */
export type ConversationReply = z.infer<typeof conversationReplySchema>;

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
  /** The AI has a reply waiting for staff. */
  hasDraft: boolean;
}

export interface ConversationMessageRow {
  id: string;
  direction: "IN" | "OUT";
  channel: ConversationChannelName;
  body: string;
  createdAt: string;
  author: MessageAuthor;
  /** Sent from the saved-answer library (no AI call). */
  fromLibrary: boolean;
  /** The admin who wrote an OUT message. */
  by: string | null;
  delivery: MessageDelivery | null;
  deliveryError: string | null;
}

export interface ConversationDetail extends Omit<ConversationListRow, "preview" | "messageCount" | "hasDraft"> {
  createdAt: string;
  customer: { id: string; name: string } | null;
  messages: ConversationMessageRow[];
  /** The AI's suggested reply to the latest message, waiting for staff. */
  draft: { body: string; intent: string; fromLibrary: boolean } | null;
  replyWindow: ReplyWindow;
  /** Where a reply can go (shared replyChannelsFor). */
  replyChannels: ReplyChannel[];
}
