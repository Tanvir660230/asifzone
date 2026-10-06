import { assertInstallId } from "./installation";

/**
 * The runtime configuration contract (Phase 1A) — what an installation's environment provides to the storefront/admin web
 * app at RUNTIME, so one built image serves every installation. Pure functions of an environment map: the web app's
 * lib/runtime-config.ts calls them with process.env on the server; tests call them with any map.
 *
 * Two halves, never mixed:
 *   - PublicRuntimeConfig — ids and URLs a browser needs anyway (pixel ids, the API's public URL, the media base). Handed to
 *     the browser by the root layout.
 *   - ServerRuntimeConfig — adds what must stay on the server (the internal API URL, the revalidate secret, the install id).
 *
 * Each value reads the new runtime name first, then the pre-Phase-1 `NEXT_PUBLIC_*` name, so an existing docker/.env keeps
 * working; the build no longer bakes any of them in.
 */

export interface PublicRuntimeConfig {
  /** The storefront's public origin — canonical URLs, sitemap, robots, Open Graph. */
  siteUrl: string;
  /** Where the BROWSER calls the API (same origin behind nginx). */
  apiUrl: string;
  /** Base that media references resolve against: `/uploads` (same-origin, default) or an absolute origin/CDN. */
  mediaBaseUrl: string;
  metaPixelId: string;
  tiktokPixelId: string;
  clarityId: string;
  googleClientId: string;
  /** VAPID public key for web-push subscriptions (the private half stays in the API). */
  vapidPublicKey: string;
}

export interface ServerRuntimeConfig {
  installId: string;
  /** Where the web SERVER calls the API — the internal service address in Docker (`http://api:4000`), so server-side
   * rendering never hairpins through the public domain and nginx. Defaults to the public API URL. */
  apiInternalUrl: string;
  /** Shared secret for POST /api/revalidate (must match the API's REVALIDATE_SECRET). */
  revalidateSecret: string;
  public: PublicRuntimeConfig;
}

type Environment = Record<string, string | undefined>;

/** Runtime variable names per public field, preferred name first. */
export const PUBLIC_RUNTIME_ENV: Readonly<Record<keyof PublicRuntimeConfig, readonly string[]>> = {
  siteUrl: ["SITE_URL", "NEXT_PUBLIC_SITE_URL"],
  apiUrl: ["PUBLIC_API_URL", "NEXT_PUBLIC_API_URL"],
  mediaBaseUrl: ["MEDIA_BASE_URL"],
  metaPixelId: ["META_PIXEL_ID", "NEXT_PUBLIC_META_PIXEL_ID"],
  tiktokPixelId: ["TIKTOK_PIXEL_ID", "NEXT_PUBLIC_TIKTOK_PIXEL_ID"],
  clarityId: ["CLARITY_ID", "NEXT_PUBLIC_CLARITY_ID"],
  googleClientId: ["GOOGLE_CLIENT_ID", "NEXT_PUBLIC_GOOGLE_CLIENT_ID"],
  vapidPublicKey: ["WEB_PUSH_PUBLIC_KEY", "NEXT_PUBLIC_VAPID_PUBLIC_KEY"],
};

const PUBLIC_DEFAULTS: PublicRuntimeConfig = {
  siteUrl: "http://localhost:3000",
  apiUrl: "http://localhost:4000",
  mediaBaseUrl: "/uploads",
  metaPixelId: "",
  tiktokPixelId: "",
  clarityId: "",
  googleClientId: "",
  vapidPublicKey: "",
};

function first(environment: Environment, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = environment[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

const withoutTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export function readPublicRuntimeConfig(environment: Environment): PublicRuntimeConfig {
  const config = { ...PUBLIC_DEFAULTS };
  for (const field of Object.keys(PUBLIC_RUNTIME_ENV) as (keyof PublicRuntimeConfig)[]) {
    config[field] = first(environment, PUBLIC_RUNTIME_ENV[field]) ?? PUBLIC_DEFAULTS[field];
  }
  config.siteUrl = withoutTrailingSlash(config.siteUrl);
  config.apiUrl = withoutTrailingSlash(config.apiUrl);
  config.mediaBaseUrl = withoutTrailingSlash(config.mediaBaseUrl) || "/uploads";
  return config;
}

/** The installation id: INSTALL_ID, required in production; `local` (or `test` under NODE_ENV=test) elsewhere. */
export function resolveInstallId(environment: Environment): string {
  const nodeEnv = environment.NODE_ENV ?? "development";
  const raw = environment.INSTALL_ID?.trim();
  if (raw) return assertInstallId(raw);
  if (nodeEnv === "production") {
    throw new Error("Missing required env var: INSTALL_ID (this installation's id — lowercase letters, digits and dashes)");
  }
  return nodeEnv === "test" ? "test" : "local";
}

export function readServerRuntimeConfig(environment: Environment): ServerRuntimeConfig {
  const publicConfig = readPublicRuntimeConfig(environment);
  return {
    installId: resolveInstallId(environment),
    apiInternalUrl: withoutTrailingSlash(first(environment, ["API_INTERNAL_URL"]) ?? publicConfig.apiUrl),
    revalidateSecret: environment.REVALIDATE_SECRET ?? "",
    public: publicConfig,
  };
}
