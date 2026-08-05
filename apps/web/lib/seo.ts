import type { Metadata } from "next";

export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

interface OpenGraphOptions {
  title: string;
  description?: string;
  url: string;
  siteName?: string;
  images?: string[];
}

/** Shared `openGraph`/`twitter` metadata block — every page assembles the same shape instead of
 * hand-rolling it, so link previews (Facebook/LinkedIn/Slack via OG, X via Twitter Card) stay consistent. */
export function buildOpenGraph({ title, description, url, siteName, images }: OpenGraphOptions): Pick<Metadata, "openGraph" | "twitter"> {
  const hasImage = Boolean(images && images.length > 0);
  return {
    openGraph: {
      title,
      description,
      url,
      siteName,
      images,
      type: "website",
    },
    twitter: {
      card: hasImage ? "summary_large_image" : "summary",
      title,
      description,
      images,
    },
  };
}
