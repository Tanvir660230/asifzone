import type { ConversationChannelName, ReplyChannel } from "./schemas/conversation";

/** The channels staff can answer a conversation on: the one the customer wrote from (a comment can also be answered
 * privately on Messenger), plus email / SMS when the customer left an address. */
export function replyChannelsFor(c: { channel: ConversationChannelName; email: string | null; phone: string | null }): ReplyChannel[] {
  const own: ReplyChannel[] =
    c.channel === "FB_COMMENT" ? ["FB_COMMENT", "MESSENGER"] : c.channel === "WHATSAPP" || c.channel === "MESSENGER" || c.channel === "INSTAGRAM" ? [c.channel] : [];
  return [...own, ...(c.email ? (["EMAIL"] as const) : []), ...(c.phone ? (["SMS"] as const) : [])];
}

/** Whether staff can still reply on a conversation's channel, per Meta's messaging policy:
 * - WhatsApp: free-form replies only within 24 hours of the customer's last message (after that only paid templates).
 * - Messenger / Instagram: a normal reply within 24 hours; up to 7 days a human (never the AI) may reply with the
 *   HUMAN_AGENT tag; then closed.
 * - Comments, email, SMS and the contact form have no window. */
export interface ReplyWindow {
  open: boolean;
  /** The reply must go out with Meta's HUMAN_AGENT tag (Messenger / Instagram, 24 h – 7 days). */
  humanAgentTag: boolean;
  /** When the window (or its current stage) closes; null when there is no window. */
  closesAt: string | null;
}

const HOUR = 3_600_000;
const STANDARD = 24 * HOUR;
const HUMAN_AGENT = 7 * 24 * HOUR;

export function replyWindow(channel: ConversationChannelName, lastInboundAt: Date | null, now: Date): ReplyWindow {
  if (channel !== "WHATSAPP" && channel !== "MESSENGER" && channel !== "INSTAGRAM") {
    return { open: true, humanAgentTag: false, closesAt: null };
  }
  if (!lastInboundAt) return { open: false, humanAgentTag: false, closesAt: null };
  const at = (ms: number) => new Date(lastInboundAt.getTime() + ms).toISOString();
  const age = now.getTime() - lastInboundAt.getTime();
  if (age <= STANDARD) return { open: true, humanAgentTag: false, closesAt: at(STANDARD) };
  if (channel === "WHATSAPP") return { open: false, humanAgentTag: false, closesAt: at(STANDARD) };
  if (age <= HUMAN_AGENT) return { open: true, humanAgentTag: true, closesAt: at(HUMAN_AGENT) };
  return { open: false, humanAgentTag: false, closesAt: at(HUMAN_AGENT) };
}
