/** Meta webhook payloads shaped after Meta's own reference examples (WhatsApp Cloud API v26, Messenger Platform,
 * Instagram Messaging, Page `feed`). Shared by the parser unit tests and the webhook integration tests. */

export const PAGE_ID = "100200300400500";
export const IG_ACCOUNT_ID = "17841400000000001";
export const WA_PHONE_NUMBER_ID = "106540352242922";
export const WA_BUSINESS_NUMBER = "8801711000000";

const wa = (value: Record<string, unknown>, field = "messages") => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [{ field, value: { messaging_product: "whatsapp", metadata: { display_phone_number: WA_BUSINESS_NUMBER, phone_number_id: WA_PHONE_NUMBER_ID }, ...value } }],
    },
  ],
});

const waContact = (waId: string, name: string) => ({ contacts: [{ profile: { name }, wa_id: waId }] });

export function waText(opts: { waId?: string; name?: string; id?: string; body?: string; timestamp?: number } = {}) {
  const waId = opts.waId ?? "8801812345678";
  return wa({
    ...waContact(waId, opts.name ?? "Rahim Uddin"),
    messages: [
      {
        from: waId,
        id: opts.id ?? "wamid.HBgNODgwMTgxMjM0NTY3OBUCABIYFjNFQjBDMEE5RTI1",
        timestamp: String(opts.timestamp ?? 1_760_700_000),
        type: "text",
        text: { body: opts.body ?? "Bhai ei panjabi tar dam koto?" },
      },
    ],
  });
}

export function waImage(caption?: string) {
  return wa({
    ...waContact("8801812345678", "Rahim Uddin"),
    messages: [
      {
        from: "8801812345678",
        id: "wamid.IMAGE1",
        timestamp: "1760700001",
        type: "image",
        image: { mime_type: "image/jpeg", sha256: "x", id: "media1", ...(caption ? { caption } : {}) },
      },
    ],
  });
}

export function waAudio() {
  return wa({
    ...waContact("8801812345678", "Rahim Uddin"),
    messages: [{ from: "8801812345678", id: "wamid.AUDIO1", timestamp: "1760700002", type: "audio", audio: { id: "media2", voice: true } }],
  });
}

export function waStatus() {
  return wa({ statuses: [{ id: "wamid.OUT1", status: "delivered", timestamp: "1760700003", recipient_id: "8801812345678" }] });
}

/** Coexistence: staff replied from the WhatsApp Business app on the phone. */
export function waEcho(opts: { id?: string; body?: string } = {}) {
  return wa(
    {
      message_echoes: [
        {
          from: WA_BUSINESS_NUMBER,
          to: "8801812345678",
          id: opts.id ?? "wamid.ECHO1",
          timestamp: "1760700100",
          type: "text",
          text: { body: opts.body ?? "Vai 1450 taka, size M/L ache" },
        },
      ],
    },
    "smb_message_echoes",
  );
}

const page = (messaging: unknown[]) => ({ object: "page", entry: [{ id: PAGE_ID, time: 1_760_700_000_000, messaging }] });

export function messengerText(opts: { psid?: string; mid?: string; text?: string } = {}) {
  return page([
    {
      sender: { id: opts.psid ?? "7001002003004005" },
      recipient: { id: PAGE_ID },
      timestamp: 1_760_700_000_000,
      message: { mid: opts.mid ?? "m_MSG1", text: opts.text ?? "Price koto?" },
    },
  ]);
}

export function messengerSticker() {
  return page([
    {
      sender: { id: "7001002003004005" },
      recipient: { id: PAGE_ID },
      timestamp: 1_760_700_000_500,
      message: { mid: "m_STICKER1", sticker_id: 369239263222822, attachments: [{ type: "image", payload: { url: "https://x/y.png", sticker_id: 369239263222822 } }] },
    },
  ]);
}

export function messengerEcho(opts: { mid?: string } = {}) {
  return page([
    {
      sender: { id: PAGE_ID },
      recipient: { id: "7001002003004005" },
      timestamp: 1_760_700_001_000,
      message: { mid: opts.mid ?? "m_ECHO1", is_echo: true, app_id: 263902037430900, text: "Ji 1450 taka" },
    },
  ]);
}

export function messengerDeliveryAndRead() {
  return page([
    { sender: { id: "7001002003004005" }, recipient: { id: PAGE_ID }, delivery: { mids: ["m_ECHO1"], watermark: 1_760_700_001_000 } },
    { sender: { id: "7001002003004005" }, recipient: { id: PAGE_ID }, timestamp: 1_760_700_002_000, read: { watermark: 1_760_700_001_000 } },
  ]);
}

export function instagramText(opts: { igsid?: string; mid?: string; text?: string } = {}) {
  return {
    object: "instagram",
    entry: [
      {
        id: IG_ACCOUNT_ID,
        time: 1_760_700_000_000,
        messaging: [
          {
            sender: { id: opts.igsid ?? "9001002003004005" },
            recipient: { id: IG_ACCOUNT_ID },
            timestamp: 1_760_700_000_000,
            message: { mid: opts.mid ?? "aWdfZAG1MSG1", text: opts.text ?? "Delivery charge koto?" },
          },
        ],
      },
    ],
  };
}

export function instagramEcho() {
  return {
    object: "instagram",
    entry: [
      {
        id: IG_ACCOUNT_ID,
        time: 1_760_700_000_000,
        messaging: [
          {
            sender: { id: IG_ACCOUNT_ID },
            recipient: { id: "9001002003004005" },
            timestamp: 1_760_700_001_000,
            message: { mid: "aWdfZAG1ECHO1", text: "Dhakar bhetore 60 taka", is_echo: true },
          },
        ],
      },
    ],
  };
}

export function feedComment(opts: { commentId?: string; parentId?: string; fromId?: string; verb?: string; message?: string } = {}) {
  const postId = `${PAGE_ID}_888000111`;
  return {
    object: "page",
    entry: [
      {
        id: PAGE_ID,
        time: 1_760_700_000,
        changes: [
          {
            field: "feed",
            value: {
              from: { id: opts.fromId ?? "5001002003004005", name: "Karim Ahmed" },
              post: { status_type: "added_photos", is_published: true, updated_time: "2026-10-17T10:00:00+0000", permalink_url: "https://www.facebook.com/x", promotion_status: "inactive", id: postId },
              message: opts.message ?? "price?",
              post_id: postId,
              comment_id: opts.commentId ?? "888000111_222333444",
              created_time: 1_760_700_000,
              item: "comment",
              parent_id: opts.parentId ?? postId,
              verb: opts.verb ?? "add",
            },
          },
        ],
      },
    ],
  };
}
