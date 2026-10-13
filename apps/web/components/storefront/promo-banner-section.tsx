import Image from "next/image";
import Link from "next/link";
import type { SectionAppearance } from "@clothing-brand/shared";
import { resolveImageUrl } from "@/lib/image-url";
import { bandTone } from "@/lib/band-tone";
import { cn } from "@/lib/utils";

interface PromoBannerSectionProps {
  heading?: string | null;
  bodyText?: string | null;
  imageUrl?: string | null;
  mobileImageUrl?: string | null;
  imageAltText?: string | null;
  linkUrl?: string | null;
  ctaLabel?: string | null;
  /** The store's own choice for this section (Storefront Studio → Style). */
  tone?: SectionAppearance["tone"];
  width?: SectionAppearance["width"];
  align?: SectionAppearance["align"];
}

/** Renders a PROMO_BANNER homepage section — the one generic "custom marketing block" type the
 * builder offers, for things like a mid-page seasonal callout that isn't the hero and isn't a
 * product carousel. With an image it is a photograph with the copy over a scrim (inside the page frame, or edge to edge
 * with `width="full"`); without one it is a typographic band in the theme's dark section color (`data-band="promo"`) —
 * an editorial callout. `align="start"` sets the copy left instead of centred. */
export function PromoBannerSection({
  heading,
  bodyText,
  imageUrl,
  mobileImageUrl,
  imageAltText,
  linkUrl,
  ctaLabel,
  tone,
  width,
  align,
}: PromoBannerSectionProps) {
  const start = align === "start";
  if (!imageUrl) {
    return (
      <section data-band="promo" data-tone={bandTone(tone)} className="ui-band-inverse bg-ink-950 text-cream-50">
        <div className={cn("px-4 py-[calc(4.5rem*var(--section-rhythm))] sm:px-6", start ? "mx-auto max-w-7xl lg:px-8" : "mx-auto max-w-4xl text-center")}>
          <span aria-hidden="true" className={cn("mb-7 block h-px w-12 bg-[color:var(--band-accent,rgb(var(--color-cream-300)))]", !start && "mx-auto")} />
          {heading && <h2 className={cn("font-display text-3xl leading-tight sm:text-4xl lg:text-5xl", start && "max-w-3xl")}>{heading}</h2>}
          {bodyText && <p className={cn("mt-5 max-w-xl text-sm leading-relaxed text-ink-300 sm:text-base", !start && "mx-auto")}>{bodyText}</p>}
          {ctaLabel && linkUrl && (
            <Link
              href={linkUrl}
              className="mt-9 inline-block rounded-[var(--control-radius)] border border-cream-50/70 px-7 py-3 text-sm ui-caps transition-colors duration-200 ease-smooth hover:border-cream-50 hover:bg-cream-50 hover:text-ink-900"
            >
              {ctaLabel}
            </Link>
          )}
        </div>
      </section>
    );
  }

  const full = width === "full";
  const alt = imageAltText || heading || "";
  const content = (
    <div className={cn("relative aspect-[16/9] overflow-hidden bg-ink-100 sm:aspect-[3/1]", !full && "rounded-lg")}>
      {mobileImageUrl ? (
        <>
          <Image src={resolveImageUrl(mobileImageUrl)} alt={alt} fill sizes="100vw" className="object-cover sm:hidden" />
          <Image src={resolveImageUrl(imageUrl)} alt={alt} fill sizes="100vw" className="hidden object-cover sm:block" />
        </>
      ) : (
        <Image src={resolveImageUrl(imageUrl)} alt={alt} fill sizes="100vw" className="object-cover" />
      )}
      {(heading || bodyText || ctaLabel) && (
        <div
          className={cn(
            "absolute inset-0 flex flex-col justify-center gap-3 bg-[color:var(--media-scrim)] text-cream-50",
            start ? "items-start px-6 text-left sm:px-12 lg:px-16" : "items-center px-4 text-center",
          )}
        >
          {heading && <h2 className="max-w-2xl font-display text-2xl sm:text-3xl lg:text-4xl">{heading}</h2>}
          {bodyText && <p className="max-w-md text-sm text-cream-100">{bodyText}</p>}
          {ctaLabel && <span className="mt-2 inline-block border border-cream-50 px-6 py-2 text-xs ui-caps">{ctaLabel}</span>}
        </div>
      )}
    </div>
  );

  return (
    <section className={cn("py-[calc(2rem*var(--section-rhythm))]", !full && "mx-auto max-w-7xl px-4 sm:px-6 lg:px-8")}>
      {linkUrl ? <Link href={linkUrl}>{content}</Link> : content}
    </section>
  );
}
