import { describe, it, expect } from "vitest";
import { classifyTraffic, isBotUserAgent } from "@clothing-brand/shared";

const own = ["asifzone.com"];
const c = (touch: Parameters<typeof classifyTraffic>[0]) => classifyTraffic(touch, own);

describe("classifyTraffic", () => {
  it("folds every Facebook host and app into one channel (the referrers seen in the store's own data)", () => {
    for (const referrer of ["https://lm.facebook.com/", "http://m.facebook.com/", "https://facebook.com/", "https://l.facebook.com/", "https://www.facebook.com/", "android-app://com.facebook.katana/"]) {
      expect(c({ referrer }).channel).toBe("facebook");
    }
  });

  it("a Facebook referrer with fbclid alone is organic (Facebook tags every outbound link); paid needs a paid medium", () => {
    expect(c({ referrer: "https://lm.facebook.com/", landingPath: "/products/x?fbclid=IwAR123" })).toEqual({ channel: "facebook", paid: false });
    expect(c({ utmSource: "fb", utmMedium: "paid", landingPath: "/?fbclid=IwAR1" })).toEqual({ channel: "facebook", paid: true });
    expect(c({ utmSource: "fb-SiteLink", utmMedium: "paid" })).toEqual({ channel: "facebook", paid: true });
    expect(c({ utmSource: "ig", utmMedium: "paid" })).toEqual({ channel: "instagram", paid: true });
  });

  it("an in-app browser with no referrer but an fbclid is still Facebook", () => {
    expect(c({ referrer: null, landingPath: "/lp/eid-panjabi?fbclid=abc" })).toEqual({ channel: "facebook", paid: false });
  });

  it("gclid / ttclid are ad clicks", () => {
    expect(c({ referrer: "https://www.google.com/", landingPath: "/?gclid=xyz" })).toEqual({ channel: "google", paid: true });
    expect(c({ landingPath: "/?ttclid=1" })).toEqual({ channel: "tiktok", paid: true });
  });

  it("knows search, WhatsApp, Instagram, Messenger, AI assistants, YouTube and email", () => {
    expect(c({ referrer: "https://www.google.com/" })).toEqual({ channel: "google", paid: false });
    expect(c({ referrer: "android-app://com.google.android.googlequicksearchbox/" }).channel).toBe("google");
    expect(c({ referrer: "https://www.bing.com/" }).channel).toBe("search_other");
    expect(c({ referrer: "https://l.wl.co/" }).channel).toBe("whatsapp");
    expect(c({ referrer: "https://wa.me/" }).channel).toBe("whatsapp");
    expect(c({ referrer: "https://instagram.com/" }).channel).toBe("instagram");
    expect(c({ referrer: "https://l.instagram.com/" }).channel).toBe("instagram");
    expect(c({ referrer: "https://www.messenger.com/" }).channel).toBe("messenger");
    expect(c({ utmSource: "chatgpt.com" }).channel).toBe("ai");
    expect(c({ referrer: "https://www.perplexity.ai/" }).channel).toBe("ai");
    expect(c({ referrer: "https://m.youtube.com/" }).channel).toBe("youtube");
    expect(c({ utmSource: "newsletter", utmMedium: "email" }).channel).toBe("email");
    expect(c({ utmSource: "bulk", utmMedium: "sms" }).channel).toBe("sms");
  });

  it("no referrer, or the store's own site, is direct; any other site is a referral", () => {
    expect(c({ referrer: null })).toEqual({ channel: "direct", paid: false });
    expect(c({ referrer: "" }).channel).toBe("direct");
    expect(c({ referrer: "http://asifzone.com/" }).channel).toBe("direct");
    expect(c({ referrer: "https://asifzone.com/admin/orders" }).channel).toBe("direct");
    expect(c({ referrer: "https://somebdblog.com/post" }).channel).toBe("referral");
  });

  it("an unknown utm source is kept as a referral, paid when its medium says so", () => {
    expect(c({ utmSource: "partner-x", utmMedium: "cpc" })).toEqual({ channel: "referral", paid: true });
  });
});

describe("isBotUserAgent", () => {
  it("flags crawlers, previews, headless browsers and scripts — never a phone browser", () => {
    for (const ua of [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "meta-externalagent/1.1",
      "python-requests/2.31",
      "curl/8.4.0",
      "Mozilla/5.0 (compatible; AhrefsBot/7.0)",
    ]) {
      expect(isBotUserAgent(ua)).toBe(true);
    }
    for (const ua of [
      "Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Linux; Android 12; RMX3363 Build/SKQ1; wv) AppleWebKit/537.36 Chrome/119 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0.0.33.116;]",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 307.0",
    ]) {
      expect(isBotUserAgent(ua)).toBe(false);
    }
    // Cubot is an Android phone brand — "CUBOT X30" must not read as a bot.
    expect(isBotUserAgent("Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Mobile Safari/537.36")).toBe(false);
    expect(isBotUserAgent(null)).toBe(false);
  });
});
