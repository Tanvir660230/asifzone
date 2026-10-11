import Image from "next/image";
import Link from "next/link";
import { resolveImageUrl } from "@/lib/image-url";

interface PromoBannerSectionProps {
  heading?: string | null;
  bodyText?: string | null;
  imageUrl?: string | null;
  mobileImageUrl?: string | null;
  linkUrl?: string | null;
  ctaLabel?: string | null;
}

/** Renders a PROMO_BANNER homepage section — the one generic "custom marketing block" type the
 * builder offers, for things like a mid-page seasonal callout that isn't the hero and isn't a
 * product carousel. With an image it is a photograph with the copy over a scrim; without one it is a
 * typographic band in the theme's dark section color (`data-band="promo"`) — an editorial callout. */
export function PromoBannerSection({
  heading,
  bodyText,
  imageUrl,
  mobileImageUrl,
  linkUrl,
  ctaLabel,
}: PromoBannerSectionProps) {
  if (!imageUrl) {
    return (
      <section data-band="promo" className="ui-band-inverse bg-ink-950 text-cream-50">
        <div className="mx-auto max-w-4xl px-4 py-[calc(4.5rem*var(--section-rhythm))] text-center sm:px-6">
          <span aria-hidden="true" className="mx-auto mb-7 block h-px w-12 bg-[color:var(--band-accent,rgb(var(--color-cream-300)))]" />
          {heading && <h2 className="font-display text-3xl leading-tight sm:text-4xl lg:text-5xl">{heading}</h2>}
          {bodyText && <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-ink-300 sm:text-base">{bodyText}</p>}
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

  const content = (
    <div className="relative aspect-[16/9] overflow-hidden rounded-lg bg-ink-100 sm:aspect-[3/1]">
      {mobileImageUrl ? (
        <>
          <Image src={resolveImageUrl(mobileImageUrl)} alt={heading || ""} fill sizes="100vw" className="object-cover sm:hidden" />
          <Image src={resolveImageUrl(imageUrl)} alt={heading || ""} fill sizes="100vw" className="hidden object-cover sm:block" />
        </>
      ) : (
        <Image src={resolveImageUrl(imageUrl)} alt={heading || ""} fill sizes="100vw" className="object-cover" />
      )}
      {(heading || bodyText || ctaLabel) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[color:var(--media-scrim)] px-4 text-center text-cream-50">
          {heading && <h2 className="font-display text-2xl sm:text-3xl">{heading}</h2>}
          {bodyText && <p className="max-w-md text-sm text-cream-100">{bodyText}</p>}
          {ctaLabel && (
            <span className="mt-2 inline-block border border-cream-50 px-6 py-2 text-xs ui-caps">
              {ctaLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );

  return (
    <section className="mx-auto max-w-7xl px-4 py-[calc(2rem*var(--section-rhythm))] sm:px-6 lg:px-8">
      {linkUrl ? <Link href={linkUrl}>{content}</Link> : content}
    </section>
  );
}
