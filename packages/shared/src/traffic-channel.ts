/**
 * Where a visit came from (docs/METRICS_REGISTRY.md §4.6): one channel per session from its first pageview — referrer,
 * UTM tags and ad click ids. Facebook alone arrives under half a dozen hosts (lm., m., l., www., the Android app), so
 * grouping by raw host split one channel into many rows; this folds them. Pure.
 */

export const TRAFFIC_CHANNELS = [
  "facebook",
  "instagram",
  "messenger",
  "whatsapp",
  "google",
  "search_other",
  "tiktok",
  "youtube",
  "ai",
  "email",
  "sms",
  "referral",
  "direct",
] as const;
export type TrafficChannel = (typeof TRAFFIC_CHANNELS)[number];

export const TRAFFIC_CHANNEL_LABELS: Record<TrafficChannel, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  messenger: "Messenger",
  whatsapp: "WhatsApp",
  google: "Google",
  search_other: "Other search",
  tiktok: "TikTok",
  youtube: "YouTube",
  ai: "AI assistants",
  email: "Email",
  sms: "SMS",
  referral: "Other websites",
  direct: "Direct",
};

export interface TrafficTouch {
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  /** The first page's path with its query string — where fbclid / gclid / ttclid ride. */
  landingPath?: string | null;
}

export interface TrafficClass {
  channel: TrafficChannel;
  /** An ad click: a paid UTM medium, or a gclid / ttclid. fbclid alone is NOT paid — Facebook adds it to every link. */
  paid: boolean;
}

const PAID_MEDIUM = /^(paid|cpc|ppc|cpm|paid[_-]?social|paidsocial|ads?|display|sponsored)$/i;

/** utm_source spellings → channel. */
const SOURCE_RULES: Array<[RegExp, TrafficChannel]> = [
  [/^(fb|facebook)([-_.].*)?$|facebook\.com/i, "facebook"],
  [/^(ig|insta|instagram)([-_.].*)?$|instagram\.com/i, "instagram"],
  [/^(messenger|m\.me)/i, "messenger"],
  [/^(wa|whatsapp)([-_.].*)?$/i, "whatsapp"],
  [/^(google|adwords|gads)([-_.].*)?$/i, "google"],
  [/^(bing|yahoo|duckduckgo)/i, "search_other"],
  [/^(tiktok|tt)([-_.].*)?$/i, "tiktok"],
  [/^(youtube|yt)([-_.].*)?$/i, "youtube"],
  [/chatgpt|openai|perplexity|gemini|claude|copilot/i, "ai"],
  [/^(email|newsletter|mail)/i, "email"],
  [/^sms/i, "sms"],
];

/** Referrer host (or android-app package) → channel. */
const HOST_RULES: Array<[RegExp, TrafficChannel]> = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$|^com\.facebook\.(katana|lite)$/i, "facebook"],
  [/(^|\.)instagram\.com$|^com\.instagram\.android$/i, "instagram"],
  [/(^|\.)messenger\.com$|^m\.me$|^com\.facebook\.orca$/i, "messenger"],
  [/(^|\.)(whatsapp\.com|wa\.me)$|^l\.wl\.co$|^com\.whatsapp(\.w4b)?$/i, "whatsapp"],
  [/(^|\.)google\.[a-z.]+$|^com\.google\.android\.(googlequicksearchbox|gm)$/i, "google"],
  [/(^|\.)(bing\.com|yahoo\.com|duckduckgo\.com|yandex\.[a-z]+|baidu\.com)$/i, "search_other"],
  [/(^|\.)tiktok\.com$|^com\.zhiliaoapp\.musically$/i, "tiktok"],
  [/(^|\.)(youtube\.com|youtu\.be)$|^com\.google\.android\.youtube$/i, "youtube"],
  [/(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|gemini\.google\.com|claude\.ai|copilot\.microsoft\.com)$/i, "ai"],
];

function hostOf(referrer: string): string | null {
  const app = /^android-app:\/\/([^/]+)/i.exec(referrer);
  if (app) return app[1]!;
  const web = /^https?:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(referrer.trim());
  return web ? web[1]!.toLowerCase().replace(/^www\./, "") : null;
}

function clickIds(path: string | null | undefined): { fbclid: boolean; gclid: boolean; ttclid: boolean } {
  const q = path?.includes("?") ? path.slice(path.indexOf("?")) : "";
  return { fbclid: /[?&]fbclid=/i.test(q), gclid: /[?&](gclid|gbraid|wbraid)=/i.test(q), ttclid: /[?&]ttclid=/i.test(q) };
}

/**
 * The channel of a session's first touch. Order of evidence: utm_source (what the store tagged), then ad click ids, then
 * the referrer host. A referrer on one of `ownHosts` (the session cookie restarted mid-visit) counts as direct.
 */
export function classifyTraffic(touch: TrafficTouch, ownHosts: readonly string[] = []): TrafficClass {
  const ids = clickIds(touch.landingPath);
  const paidMedium = Boolean(touch.utmMedium && PAID_MEDIUM.test(touch.utmMedium.trim()));
  const source = touch.utmSource?.trim();
  if (source) {
    const hit = SOURCE_RULES.find(([re]) => re.test(source));
    if (hit) return { channel: hit[1], paid: paidMedium || ids.gclid || ids.ttclid };
  }
  const medium = touch.utmMedium?.trim().toLowerCase();
  if (medium === "email") return { channel: "email", paid: false };
  if (medium === "sms") return { channel: "sms", paid: false };
  if (ids.gclid) return { channel: "google", paid: true };
  if (ids.ttclid) return { channel: "tiktok", paid: true };

  const host = touch.referrer ? hostOf(touch.referrer) : null;
  if (host) {
    const own = ownHosts.some((h) => host === h.replace(/^www\./i, "") || host.endsWith(`.${h.replace(/^www\./i, "")}`));
    if (!own) {
      const hit = HOST_RULES.find(([re]) => re.test(host));
      return { channel: hit ? hit[1] : ids.fbclid ? "facebook" : "referral", paid: paidMedium };
    }
  }
  // No usable referrer (in-app browsers often send none): an fbclid still says Facebook.
  if (ids.fbclid) return { channel: "facebook", paid: paidMedium };
  if (source) return { channel: "referral", paid: paidMedium };
  return { channel: "direct", paid: false };
}

/** Crawlers, link previews, headless browsers and scripts. In-app browsers (FB_IAB, Instagram) are people. */
const BOT_UA =
  /\bbot\b|[a-z]bot\/|googlebot|bingbot|applebot|yandexbot|crawl|spider|slurp|facebookexternalhit|meta-externalagent|facebookcatalog|headlesschrome|lighthouse|pagespeed|gtmetrix|python-|python\/|curl\/|wget\/|httpclient|axios\/|node-fetch|go-http-client|okhttp|java\/|scrapy|phantomjs|selenium|puppeteer|playwright|bytespider|petalbot|ahrefs|semrush|mj12bot|dotbot|preview/i;

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent && BOT_UA.test(userAgent));
}
