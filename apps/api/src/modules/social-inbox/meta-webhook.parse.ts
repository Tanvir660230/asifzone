import { phoneFromInternationalDigits } from "@clothing-brand/shared";

/** One customer message (IN) or one reply sent outside the Inbox (OUT echo), read from a Meta webhook. */
export interface InboundEvent {
  channel: "WHATSAPP" | "MESSENGER" | "INSTAGRAM" | "FB_COMMENT";
  direction: "IN" | "OUT";
  /** WhatsApp: the customer's wa_id; Messenger: PSID; Instagram: IGSID; comments: the top-level comment id. */
  threadId: string;
  /** wamid / mid / comment id — the same message delivered twice has the same id. */
  externalId: string;
  name: string | null;
  /** WhatsApp only: "01XXXXXXXXX" for a Bangladeshi number, "+<digits>" otherwise. */
  phone: string | null;
  body: string;
  at: Date;
  postId?: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : typeof v === "number" ? String(v) : null);

const PLACEHOLDER: Record<string, string> = {
  image: "[Photo]",
  video: "[Video]",
  audio: "[Voice message]",
  sticker: "[Sticker]",
  document: "[File]",
  file: "[File]",
  location: "[Location]",
  contacts: "[Contact card]",
  reel: "[Reel]",
  ig_reel: "[Reel]",
  share: "[Shared post]",
  story_mention: "[Story mention]",
};

/** Parses one Meta webhook body (WhatsApp Cloud API, Messenger, Instagram, Page feed) into events. Never throws: anything
 * it does not recognise — statuses, receipts, reactions, edits, the Page's own comments — is skipped. */
export function parseMetaWebhook(body: unknown, ids: { pageId: string; igAccountId: string }): InboundEvent[] {
  if (!isObj(body)) return [];
  const events: InboundEvent[] = [];
  for (const entry of arr(body.entry)) {
    if (!isObj(entry)) continue;
    if (body.object === "whatsapp_business_account") {
      for (const change of arr(entry.changes)) if (isObj(change) && isObj(change.value)) events.push(...whatsApp(change.field, change.value));
    } else if (body.object === "page") {
      for (const m of arr(entry.messaging)) {
        const e = directMessage("MESSENGER", m, ids.pageId);
        if (e) events.push(e);
      }
      for (const change of arr(entry.changes)) {
        const e = isObj(change) && change.field === "feed" && isObj(change.value) ? feedComment(change.value, ids.pageId) : null;
        if (e) events.push(e);
      }
    } else if (body.object === "instagram") {
      for (const m of arr(entry.messaging)) {
        const e = directMessage("INSTAGRAM", m, ids.igAccountId);
        if (e) events.push(e);
      }
    }
  }
  return events;
}

const whatsAppPhone = phoneFromInternationalDigits;

function whatsAppBody(m: Obj): string | null {
  const type = str(m.type);
  if (!type) return null;
  if (type === "text") return isObj(m.text) ? str(m.text.body) : null;
  if (type === "button") return isObj(m.button) ? str(m.button.text) : null;
  if (type === "interactive" && isObj(m.interactive)) {
    const reply = m.interactive.button_reply ?? m.interactive.list_reply;
    return isObj(reply) ? str(reply.title) : null;
  }
  const placeholder = PLACEHOLDER[type];
  if (!placeholder) return null; // reaction, revoke, edit, system, unsupported…
  const media = m[type];
  const caption = isObj(media) ? str(media.caption) : null;
  return caption ? `${placeholder} ${caption}` : placeholder;
}

function whatsApp(field: unknown, value: Obj): InboundEvent[] {
  const events: InboundEvent[] = [];
  if (field === "messages") {
    const names = new Map<string, string>();
    for (const c of arr(value.contacts)) {
      if (isObj(c) && isObj(c.profile) && str(c.wa_id) && str(c.profile.name)) names.set(str(c.wa_id)!, str(c.profile.name)!);
    }
    for (const m of arr(value.messages)) {
      if (!isObj(m)) continue;
      const from = str(m.from);
      const id = str(m.id);
      const text = whatsAppBody(m);
      if (!from || !id || text === null) continue;
      events.push({ channel: "WHATSAPP", direction: "IN", threadId: from, externalId: id, name: names.get(from) ?? null, phone: whatsAppPhone(from), body: text, at: seconds(m.timestamp) });
    }
  } else if (field === "smb_message_echoes") {
    for (const m of arr(value.message_echoes)) {
      if (!isObj(m)) continue;
      const to = str(m.to);
      const id = str(m.id);
      const text = whatsAppBody(m);
      if (!to || !id || text === null) continue;
      events.push({ channel: "WHATSAPP", direction: "OUT", threadId: to, externalId: id, name: null, phone: whatsAppPhone(to), body: text, at: seconds(m.timestamp) });
    }
  }
  return events;
}

/** Messenger and Instagram share the Send/Receive API shape. */
function directMessage(channel: "MESSENGER" | "INSTAGRAM", item: unknown, ownId: string): InboundEvent | null {
  if (!isObj(item) || !isObj(item.message) || !isObj(item.sender) || !isObj(item.recipient)) return null;
  const message = item.message;
  const mid = str(message.mid);
  const sender = str(item.sender.id);
  const recipient = str(item.recipient.id);
  if (!mid || !sender || !recipient) return null;
  if (message.is_deleted === true || message.is_unsupported === true) return null;
  const echo = message.is_echo === true || sender === ownId;
  let text = str(message.text);
  if (!text) {
    const first = arr(message.attachments)[0];
    if (message.sticker_id !== undefined) text = PLACEHOLDER.sticker!;
    else if (isObj(first)) text = PLACEHOLDER[str(first.type) ?? ""] ?? "[Attachment]";
  }
  if (!text) return null;
  return {
    channel,
    direction: echo ? "OUT" : "IN",
    threadId: echo ? recipient : sender,
    externalId: mid,
    name: null,
    phone: null,
    body: text,
    at: new Date(typeof item.timestamp === "number" ? item.timestamp : Date.now()),
  };
}

function feedComment(value: Obj, pageId: string): InboundEvent | null {
  if (value.item !== "comment" || value.verb !== "add") return null;
  const from = isObj(value.from) ? value.from : null;
  const commentId = str(value.comment_id);
  const postId = str(value.post_id);
  const text = str(value.message);
  if (!from || !commentId || !postId || !text || str(from.id) === pageId) return null;
  const parent = str(value.parent_id);
  return {
    channel: "FB_COMMENT",
    direction: "IN",
    threadId: parent && parent !== postId ? parent : commentId,
    externalId: commentId,
    name: str(from.name),
    phone: null,
    body: text,
    at: seconds(value.created_time),
    postId,
  };
}

function seconds(v: unknown): Date {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? new Date(n * 1000) : new Date();
}
