/**
 * The web app's Content-Security-Policy — one source of truth, applied per request by middleware.ts (which mints the
 * nonce). Next.js reads the nonce from the request's CSP header and puts it on its own scripts, so every page renders
 * dynamically (app/layout.tsx reads headers()).
 *
 * Scripts: a per-request nonce + 'strict-dynamic' and no host allowlist. Only scripts carrying the nonce (Next's own) run,
 * and scripts THEY create (the Meta/TikTok pixel loaders in lib/pixels/, Clarity, Tawk, Google sign-in) are trusted
 * through 'strict-dynamic'. An injected <script> or inline handler has no nonce and is blocked. No 'unsafe-inline' or
 * 'unsafe-eval' for scripts in production ('unsafe-eval' only under `next dev`, which needs it for fast refresh).
 *
 * The other directives list what the app actually loads (docs/MASTER_SYSTEM_INVENTORY.md SEC-03):
 *   - connect: our API, the pixel/heatmap/live-chat beacons, Google sign-in;
 *   - frame: product videos (youtube-nocookie / Vimeo, the only embeds toVideoEmbed builds), Google sign-in, Tawk,
 *     same-origin (Product Builder preview) and blob: (label PDF printing);
 *   - img / media allow any https host: product descriptions, logos, banners and direct .mp4/.webm product videos are
 *     admin-authored and may point at any host. Images and media can't run script.
 *   - style keeps 'unsafe-inline': React style props, framer-motion and the Google/Tawk widgets set inline styles.
 *     A CSS injection can't execute script.
 *   - object 'none', base-uri 'self', form-action 'self' (gateways are reached by navigation, not form posts),
 *     frame-ancestors 'self' (only our own Product Builder may frame a page).
 */
export interface CspOptions {
  nonce: string;
  /** The public API URL's origin (runtime configuration) — the same origin in production (nginx), :4000 locally. */
  apiOrigin: string;
  isDev: boolean;
}

const TRACKING_CONNECT = [
  "https://www.facebook.com",
  "https://connect.facebook.net",
  "https://*.tiktok.com",
  "https://*.tiktokw.us",
  "https://*.clarity.ms",
];
const LIVE_CHAT = ["https://*.tawk.to", "wss://*.tawk.to"];
const GOOGLE_SIGN_IN = "https://accounts.google.com";
const VIDEO_EMBEDS = ["https://www.youtube-nocookie.com", "https://player.vimeo.com"];

export function buildContentSecurityPolicy({ nonce, apiOrigin, isDev }: CspOptions): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'", GOOGLE_SIGN_IN],
    "img-src": ["'self'", "data:", "blob:", "https:", apiOrigin],
    "font-src": ["'self'", "data:", "https://*.tawk.to"],
    "connect-src": ["'self'", apiOrigin, ...TRACKING_CONNECT, ...LIVE_CHAT, GOOGLE_SIGN_IN, ...(isDev ? ["ws:"] : [])],
    "frame-src": ["'self'", "blob:", ...VIDEO_EMBEDS, GOOGLE_SIGN_IN, "https://*.tawk.to"],
    "media-src": ["'self'", "blob:", "https:", apiOrigin],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'self'"],
  };
  // No upgrade-insecure-requests: production is https-only already (nginx redirect + HSTS), and it would break a local
  // `next start` against the http://localhost API.
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${[...new Set(sources)].join(" ")}`)
    .join("; ");
}

/** 128 random bits, base64 — a fresh one per request. Edge-runtime safe (Web Crypto only). */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
