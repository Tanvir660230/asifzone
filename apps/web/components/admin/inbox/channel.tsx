import { Facebook, Globe, Instagram, Mail, MessageCircle, MessageSquareText, Smartphone, type LucideIcon } from "lucide-react";
import type { ConversationChannelName, ReplyChannel } from "@clothing-brand/shared";
import { cn } from "@/lib/utils";

/** How each Inbox channel is named and drawn. Icons stay neutral (ink), like the rest of the admin. */
export const CHANNEL_META: Record<ConversationChannelName, { label: string; Icon: LucideIcon }> = {
  WHATSAPP: { label: "WhatsApp", Icon: MessageCircle },
  MESSENGER: { label: "Messenger", Icon: Facebook },
  INSTAGRAM: { label: "Instagram", Icon: Instagram },
  FB_COMMENT: { label: "Comment", Icon: MessageSquareText },
  WEB_FORM: { label: "Website", Icon: Globe },
  EMAIL: { label: "Email", Icon: Mail },
  SMS: { label: "SMS", Icon: Smartphone },
};

/** The channel filter: WEB_FORM stands for "website contact form". */
export const CHANNEL_FILTERS: Array<{ value: ConversationChannelName; label: string }> = [
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "MESSENGER", label: "Messenger" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "FB_COMMENT", label: "Comments" },
  { value: "WEB_FORM", label: "Website form" },
];

export function ChannelIcon({ channel, size = 14, className }: { channel: ConversationChannelName; size?: number; className?: string }) {
  const { Icon, label } = CHANNEL_META[channel];
  return (
    <>
      <Icon size={size} className={cn("shrink-0", className)} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </>
  );
}

/** A reply option's name in the composer. On a comment thread, Messenger means a private message to the commenter. */
export function replyChannelLabel(channel: ReplyChannel, thread: ConversationChannelName): string {
  if (thread === "FB_COMMENT") {
    if (channel === "FB_COMMENT") return "Public reply";
    if (channel === "MESSENGER") return "Private message";
  }
  return CHANNEL_META[channel].label;
}

export const SOCIAL_REPLY: ReadonlySet<ReplyChannel> = new Set(["WHATSAPP", "MESSENGER", "INSTAGRAM", "FB_COMMENT"]);

/** "5h" / "40m" until an ISO time; null once it has passed. */
export function timeUntil(iso: string, now = Date.now()): string | null {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)} days`;
}

export const INTENT_LABEL: Record<string, string> = {
  price: "Price",
  stock: "Stock",
  delivery_charge: "Delivery charge",
  order_status: "Order status",
  how_to_order: "How to order",
  other: "Needs you",
  saved: "Saved answer",
};
