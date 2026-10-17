import { describe, it, expect } from "vitest";
import { parseMetaWebhook } from "./meta-webhook.parse";
import * as fx from "./meta-webhook.fixtures";

const ids = { pageId: fx.PAGE_ID, igAccountId: fx.IG_ACCOUNT_ID };
const parse = (body: unknown) => parseMetaWebhook(body, ids);

describe("parseMetaWebhook — WhatsApp", () => {
  it("a text message is one IN event with the sender's name and local phone", () => {
    expect(parse(fx.waText())).toEqual([
      {
        channel: "WHATSAPP",
        direction: "IN",
        threadId: "8801812345678",
        externalId: "wamid.HBgNODgwMTgxMjM0NTY3OBUCABIYFjNFQjBDMEE5RTI1",
        name: "Rahim Uddin",
        phone: "01812345678",
        body: "Bhai ei panjabi tar dam koto?",
        at: new Date(1_760_700_000 * 1000),
      },
    ]);
  });

  it("a number outside Bangladesh keeps its international form", () => {
    expect(parse(fx.waText({ waId: "971501234567" }))[0]).toMatchObject({ threadId: "971501234567", phone: "+971501234567" });
  });

  it("media becomes a readable placeholder, keeping a caption", () => {
    expect(parse(fx.waImage("eta ache?"))[0]!.body).toBe("[Photo] eta ache?");
    expect(parse(fx.waImage())[0]!.body).toBe("[Photo]");
    expect(parse(fx.waAudio())[0]!.body).toBe("[Voice message]");
  });

  it("delivery statuses carry no message", () => {
    expect(parse(fx.waStatus())).toEqual([]);
  });

  it("a reply sent from the WhatsApp Business app is an OUT echo on the customer's thread", () => {
    expect(parse(fx.waEcho())).toEqual([
      expect.objectContaining({ channel: "WHATSAPP", direction: "OUT", threadId: "8801812345678", externalId: "wamid.ECHO1", body: "Vai 1450 taka, size M/L ache" }),
    ]);
  });
});

describe("parseMetaWebhook — Messenger", () => {
  it("a text message is IN on the sender's PSID", () => {
    expect(parse(fx.messengerText())).toEqual([
      { channel: "MESSENGER", direction: "IN", threadId: "7001002003004005", externalId: "m_MSG1", name: null, phone: null, body: "Price koto?", at: new Date(1_760_700_000_000) },
    ]);
  });

  it("a sticker is a placeholder", () => {
    expect(parse(fx.messengerSticker())[0]!.body).toBe("[Sticker]");
  });

  it("an echo is OUT on the recipient's PSID", () => {
    expect(parse(fx.messengerEcho())[0]).toMatchObject({ direction: "OUT", threadId: "7001002003004005", externalId: "m_ECHO1" });
  });

  it("delivery and read receipts carry no message", () => {
    expect(parse(fx.messengerDeliveryAndRead())).toEqual([]);
  });
});

describe("parseMetaWebhook — Instagram", () => {
  it("a DM is IN on channel INSTAGRAM", () => {
    expect(parse(fx.instagramText())[0]).toMatchObject({ channel: "INSTAGRAM", direction: "IN", threadId: "9001002003004005", body: "Delivery charge koto?" });
  });

  it("an echo from our own account is OUT", () => {
    expect(parse(fx.instagramEcho())[0]).toMatchObject({ channel: "INSTAGRAM", direction: "OUT", threadId: "9001002003004005" });
  });
});

describe("parseMetaWebhook — Facebook comments", () => {
  it("a new top-level comment is its own thread on the post", () => {
    expect(parse(fx.feedComment())).toEqual([
      {
        channel: "FB_COMMENT",
        direction: "IN",
        threadId: "888000111_222333444|5001002003004005",
        externalId: "888000111_222333444",
        name: "Karim Ahmed",
        phone: null,
        body: "price?",
        at: new Date(1_760_700_000 * 1000),
        postId: `${fx.PAGE_ID}_888000111`,
      },
    ]);
  });

  it("the commenter's own reply under their comment joins their thread", () => {
    expect(parse(fx.feedComment({ commentId: "888000111_999", parentId: "888000111_222333444" }))[0]).toMatchObject({
      threadId: "888000111_222333444|5001002003004005",
      externalId: "888000111_999",
    });
  });

  it("someone else replying under that comment is a different customer's thread", () => {
    expect(parse(fx.feedComment({ commentId: "888000111_998", parentId: "888000111_222333444", fromId: "5009" }))[0]).toMatchObject({
      threadId: "888000111_222333444|5009",
    });
  });

  it("the Page's own comments, edits and removals are ignored", () => {
    expect(parse(fx.feedComment({ fromId: fx.PAGE_ID }))).toEqual([]);
    expect(parse(fx.feedComment({ verb: "remove" }))).toEqual([]);
    expect(parse(fx.feedComment({ verb: "edited" }))).toEqual([]);
  });
});

describe("parseMetaWebhook — only this store's assets", () => {
  it("events for another Page, Instagram account or WhatsApp number on the same Meta app are skipped", () => {
    const other = { pageId: "999", igAccountId: "888", waPhoneNumberId: "777" };
    expect(parseMetaWebhook(fx.messengerText(), other)).toEqual([]);
    expect(parseMetaWebhook(fx.feedComment(), other)).toEqual([]);
    expect(parseMetaWebhook(fx.instagramText(), other)).toEqual([]);
    expect(parseMetaWebhook(fx.waText(), other)).toEqual([]);
    expect(parseMetaWebhook(fx.waText(), { ...ids, waPhoneNumberId: fx.WA_PHONE_NUMBER_ID })).toHaveLength(1);
  });
});

describe("parseMetaWebhook — anything else", () => {
  it.each([{}, null, "x", 42, { object: "user", entry: [] }, { object: "page", entry: [{ messaging: [{ nonsense: true }] }] }, { object: "whatsapp_business_account", entry: [{ changes: [{ value: null }] }] }])(
    "never throws: %j",
    (body) => {
      expect(parse(body)).toEqual([]);
    },
  );
});
