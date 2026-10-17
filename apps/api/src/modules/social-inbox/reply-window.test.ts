import { describe, it, expect } from "vitest";
import { replyWindow } from "@clothing-brand/shared";

const now = new Date("2026-10-17T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const H = 3_600_000;
const M = 60_000;

describe("replyWindow", () => {
  it("WhatsApp: open for 24 hours after the customer's last message, then closed", () => {
    expect(replyWindow("WHATSAPP", ago(23 * H + 59 * M), now)).toMatchObject({ open: true, humanAgentTag: false });
    expect(replyWindow("WHATSAPP", ago(24 * H + M), now)).toMatchObject({ open: false, humanAgentTag: false });
    expect(replyWindow("WHATSAPP", null, now)).toMatchObject({ open: false });
  });

  it("WhatsApp: closesAt is the last inbound message + 24 hours", () => {
    const last = ago(2 * H);
    expect(replyWindow("WHATSAPP", last, now).closesAt).toBe(new Date(last.getTime() + 24 * H).toISOString());
  });

  it.each(["MESSENGER", "INSTAGRAM"] as const)("%s: standard within 24h, human-agent tag up to 7 days, then closed", (channel) => {
    expect(replyWindow(channel, ago(23 * H), now)).toMatchObject({ open: true, humanAgentTag: false });
    expect(replyWindow(channel, ago(25 * H), now)).toMatchObject({ open: true, humanAgentTag: true });
    expect(replyWindow(channel, ago(7 * 24 * H + M), now)).toMatchObject({ open: false });
  });

  it.each(["FB_COMMENT", "EMAIL", "SMS", "WEB_FORM"] as const)("%s: no window", (channel) => {
    expect(replyWindow(channel, ago(400 * H), now)).toEqual({ open: true, humanAgentTag: false, closesAt: null });
    expect(replyWindow(channel, null, now)).toEqual({ open: true, humanAgentTag: false, closesAt: null });
  });
});
