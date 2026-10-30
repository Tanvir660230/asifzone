import Image from "next/image";
import Link from "next/link";
import { resolveImageUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";

interface TahafiHeroProps {
  storeName: string;
  tagline?: string | null;
  headline?: string | null;
  subtext?: string | null;
  bodyText?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  secondaryCtaLabel?: string | null;
  secondaryCtaHref?: string | null;
  imageUrl?: string | null;
  mobileImageUrl?: string | null;
  imageAltText?: string | null;
}

/** Shown only when the hero has no button label of its own — the classic hero's neutral fallback. */
const FALLBACK_CTA_LABEL = "Explore the collection";

/** Glass on a photograph: dark, blurred, a lit top edge. */
const PHOTO_GLASS =
  "border border-white/20 bg-black/30 shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] backdrop-blur-xl backdrop-saturate-150";

/** The glossy white pill on a photograph. */
const WHITE_PILL =
  "inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-white to-cream-200 px-6 text-[0.9375rem] font-semibold text-ink-900 shadow-[inset_0_1px_0_#fff,0_6px_16px_-8px_rgb(0_0_0/0.5)] transition-transform duration-200 ease-smooth active:scale-[0.97]";

/**
 * The Tahafi hero, like a Today card on an iPhone: the photograph in one large rounded card, the headline set on its
 * lower edge over a scrim, and the featured piece on a glass bar with the way to order it. The small line above the
 * headline (Admin → Homepage → Hero) is the bar's text, split at "|" into the piece and its details — "Utility Jacket |
 * Olive cotton twill | ৳2,950". Without a photograph the card is ink.
 */
export function TahafiHero({
  storeName,
  tagline,
  headline,
  subtext,
  bodyText,
  ctaLabel,
  ctaHref,
  secondaryCtaLabel,
  secondaryCtaHref,
  imageUrl,
  mobileImageUrl,
  imageAltText,
}: TahafiHeroProps) {
  const alt = imageAltText || headline || storeName;
  const [piece, ...details] = (subtext ?? "").split("|").map((part) => part.trim()).filter(Boolean);
  const cta = (
    <Link href={ctaHref || "/search"} className={WHITE_PILL}>
      {ctaLabel || FALLBACK_CTA_LABEL}
    </Link>
  );

  return (
    <section className="mx-auto max-w-7xl px-3 pt-3 sm:px-6 sm:pt-5 lg:px-8">
      <div className="relative isolate h-[min(76svh,34rem)] overflow-hidden rounded-[2rem] bg-ink-900 sm:h-[min(80svh,42rem)]">
        {imageUrl && (
          <>
            {mobileImageUrl && (
              <Image src={resolveImageUrl(mobileImageUrl)} alt={alt} fill priority sizes="(min-width: 640px) 1px, 100vw" className="object-cover sm:hidden" />
            )}
            <Image
              src={resolveImageUrl(imageUrl)}
              alt={alt}
              fill
              priority
              sizes={mobileImageUrl ? "(min-width: 1280px) 1216px, (min-width: 640px) 100vw, 1px" : "(min-width: 1280px) 1216px, 100vw"}
              className={cn("object-cover object-[50%_20%]", mobileImageUrl && "hidden sm:block")}
            />
            <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-black/0" />
          </>
        )}

        <div className="absolute inset-x-0 bottom-0 p-3 sm:p-8 lg:p-12">
          <div className="px-2 pb-4 sm:px-0 sm:pb-6">
            <h2 className="max-w-[17ch] text-balance font-display text-[2rem] leading-[1.05] text-cream-50 sm:text-5xl lg:text-6xl">
              {headline || tagline || storeName}
            </h2>
            {bodyText && <p className="mt-3 max-w-md text-[0.9375rem] leading-relaxed text-cream-50/85 sm:text-lg">{bodyText}</p>}
          </div>

          {piece ? (
            <div className={cn("flex items-center gap-3 rounded-[1.375rem] p-2 pl-4 text-cream-50 sm:max-w-md", PHOTO_GLASS)}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.9375rem] font-semibold">{piece}</p>
                {details.length > 0 && <p className="truncate text-[0.8125rem] text-cream-50/80">{details.join(" · ")}</p>}
              </div>
              {cta}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 px-2 sm:px-0">{cta}</div>
          )}
          {secondaryCtaLabel && secondaryCtaHref && (
            <Link href={secondaryCtaHref} className="mt-2 inline-flex h-10 items-center px-2 text-sm font-medium text-cream-50/90 underline-offset-4 hover:underline sm:px-0">
              {secondaryCtaLabel}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
