import { siteUrl } from "@/lib/runtime-config";

/** A product's landing page (app/(landing)/lp/[slug]) — the one-page order page an ad links to. */
export const landingPagePath = (slug: string) => `/lp/${slug}`;

/** The full address to paste into an ad, on this installation's own domain. */
export const landingPageUrl = (slug: string) => `${siteUrl()}${landingPagePath(slug)}`;
