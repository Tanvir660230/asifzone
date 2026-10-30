import Image from "next/image";
import Link from "next/link";
import { resolveImageUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";
import { Canopy } from "./canopy";
import { HangTag } from "./hang-tag";
import { TwinDiamonds } from "./twin-diamonds";

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

/**
 * The Tahafi hero: the photograph edge to edge under the ink header, whose edge hangs down into it as the bar of the mark
 * (Canopy) with the twin diamonds seated in the dip; the headline on the photograph's lower edge, over a scrim so it never
 * depends on the picture; the small line above the headline on a hang-tag. The page's one moment of motion: the diamonds
 * settle into the dip and the tag swings once (globals.css, off with reduced motion). Without a photograph it is the
 * same composition on ink.
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
  return (
    <section data-band="hero" className="ui-band-inverse relative isolate overflow-hidden bg-ink-950 text-cream-50">
      <div className={cn("relative", imageUrl ? "h-[min(80svh,40rem)] sm:h-[min(82svh,46rem)]" : "pb-16 pt-32 sm:pb-24 sm:pt-44")}>
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
              sizes={mobileImageUrl ? "(min-width: 640px) 100vw, 1px" : "100vw"}
              className={cn("object-cover object-[50%_8%]", mobileImageUrl && "hidden sm:block")}
            />
            <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-ink-950/85 via-ink-950/25 to-transparent" />
          </>
        )}

        <Canopy className="absolute inset-x-0 top-0 fill-ink-950" />
        <TwinDiamonds className="ui-diamonds-settle absolute left-1/2 top-[clamp(0.4rem,1.2vw,1.1rem)] w-[clamp(2.25rem,4.5vw,4rem)] -translate-x-1/2 text-cream-50" />
        {imageUrl && subtext && <HangTag text={subtext} href={ctaHref} className="ui-tag-sway right-5 top-[clamp(1rem,2.4vw,2rem)] sm:right-[9%]" />}

        <div className={cn(imageUrl && "absolute inset-x-0 bottom-0")}>
          <div className="mx-auto max-w-7xl px-5 pb-10 sm:px-8 sm:pb-14 lg:pb-16">
            {!imageUrl && subtext && <p className="mb-5 text-sm text-ink-300">{subtext}</p>}
            <h2 className="max-w-[15ch] text-balance font-display text-[2.875rem] leading-[0.96] sm:text-7xl lg:text-[5.5rem]">
              {headline || tagline || storeName}
            </h2>
            {bodyText && <p className="mt-4 max-w-md text-base leading-relaxed text-ink-300 sm:mt-5 sm:text-lg">{bodyText}</p>}
            <div className="mt-6 flex flex-col gap-2 sm:mt-8 sm:flex-row sm:items-center sm:gap-4">
              <Link
                href={ctaHref || "/search"}
                className="inline-flex h-12 items-center justify-center rounded-full bg-cream-50 px-8 text-[0.9375rem] font-medium text-ink-950 transition-colors duration-200 ease-smooth hover:bg-cream-200"
              >
                {ctaLabel || FALLBACK_CTA_LABEL}
              </Link>
              {secondaryCtaLabel && secondaryCtaHref && (
                <Link href={secondaryCtaHref} className="inline-flex h-12 items-center justify-center px-2 text-[0.9375rem] text-cream-50 underline decoration-cream-50/40 underline-offset-[6px] hover:decoration-cream-50">
                  {secondaryCtaLabel}
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
