import {
  installationNamespace,
  readPublicRuntimeConfig,
  readServerRuntimeConfig,
  resolveMediaUrl,
  type PublicRuntimeConfig,
  type ServerRuntimeConfig,
} from "@clothing-brand/shared";

/**
 * The web app's ONE source of installation configuration (Phase 1A). Nothing installation-specific is baked into the
 * build: the server reads its environment at runtime (contract: @clothing-brand/shared runtime-config.ts), and the browser
 * receives the public half from the root layout (`RUNTIME_CONFIG_ELEMENT_ID` + <RuntimeConfig>). Read values through the
 * functions below at the moment they are needed — never into a module-level constant.
 */

export const RUNTIME_CONFIG_ELEMENT_ID = "__runtime_config";

const isServer = typeof window === "undefined";
let serverConfig: ServerRuntimeConfig | null = null;
let browserConfig: PublicRuntimeConfig | null = null;

/** Server only. The process environment is passed as a whole (never `process.env.X`), so `next build` cannot inline it. */
export function serverRuntimeConfig(): ServerRuntimeConfig {
  if (!isServer) throw new Error("serverRuntimeConfig() is server-only");
  const environment = process.env as Record<string, string | undefined>;
  // `next build` runs with NODE_ENV=production while it probes pages; no installation exists at build time, and nothing it
  // renders is kept (every page renders per request). The running server still requires INSTALL_ID.
  if (environment["NEXT_PHASE"] === "phase-production-build" && !environment["INSTALL_ID"]) {
    return readServerRuntimeConfig({ ...environment, INSTALL_ID: "build" });
  }
  serverConfig ??= readServerRuntimeConfig(environment);
  return serverConfig;
}

/** Called by <RuntimeConfig> while it renders, before any child reads a value. */
export function setPublicRuntimeConfig(value: PublicRuntimeConfig): void {
  if (!isServer) browserConfig = value;
}

/** The public configuration — on the server straight from the environment, in the browser as the layout handed it over. */
export function publicRuntimeConfig(): PublicRuntimeConfig {
  if (isServer) return serverRuntimeConfig().public;
  if (browserConfig) return browserConfig;
  const element = document.getElementById(RUNTIME_CONFIG_ELEMENT_ID);
  if (element?.textContent) {
    browserConfig = JSON.parse(element.textContent) as PublicRuntimeConfig;
    return browserConfig;
  }
  return readPublicRuntimeConfig({});
}

/** Where to call the API from here: the internal service address on the server, the public URL in the browser. */
export function apiBaseUrl(): string {
  return isServer ? serverRuntimeConfig().apiInternalUrl : publicRuntimeConfig().apiUrl;
}

export function siteUrl(): string {
  return publicRuntimeConfig().siteUrl;
}

/** A stored media reference as a loadable URL (same-origin `/uploads/…` by default). */
export function mediaUrl(ref: string): string;
export function mediaUrl(ref: string | null | undefined): string | null;
export function mediaUrl(ref: string | null | undefined): string | null {
  return resolveMediaUrl(ref, publicRuntimeConfig().mediaBaseUrl);
}

/** A media URL that must be absolute (Open Graph, JSON-LD, links leaving the site). */
export function absoluteMediaUrl(ref: string | null | undefined): string | null {
  const url = mediaUrl(ref);
  if (!url || /^(https?:|blob:|data:)/i.test(url)) return url;
  return `${siteUrl()}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** This installation's Next.js data-cache tag (server only) — tags of two installations can never collide. */
export function cacheTag(tag: string): string {
  return installationNamespace(serverRuntimeConfig().installId).cacheTag(tag);
}
