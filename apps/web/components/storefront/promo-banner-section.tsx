import Image from "next/image";
import Link from "next/link";

interface PromoBannerSectionProps {
  heading?: string | null;
  bodyText?: string | null;
  imageUrl: string;
  mobileImageUrl?: string | null;
  linkUrl?: string | null;
  ctaLabel?: string | null;
}

/** Renders a PROMO_BANNER homepage section — the one generic "custom marketing block" type the
 * builder offers, for things like a mid-page seasonal callout that isn't the hero and isn't a
 * product carousel. */
export function PromoBannerSection({
  heading,
  bodyText,
  imageUrl,
  mobileImageUrl,
  linkUrl,
  ctaLabel,
}: PromoBannerSectionProps) {
  const content = (
    <div className="relative aspect-[16/9] overflow-hidden rounded-lg bg-ink-100 sm:aspect-[3/1]">
      {mobileImageUrl ? (
        <>
          <Image src={mobileImageUrl} alt={heading || ""} fill sizes="100vw" className="object-cover sm:hidden" />
          <Image src={imageUrl} alt={heading || ""} fill sizes="100vw" className="hidden object-cover sm:block" />
        </>
      ) : (
        <Image src={imageUrl} alt={heading || ""} fill sizes="100vw" className="object-cover" />
      )}
      {(heading || bodyText || ctaLabel) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink-950/35 px-4 text-center text-cream-50">
          {heading && <h2 className="font-display text-2xl sm:text-3xl">{heading}</h2>}
          {bodyText && <p className="max-w-md text-sm text-cream-100">{bodyText}</p>}
          {ctaLabel && (
            <span className="mt-2 inline-block border border-cream-50 px-6 py-2 text-xs uppercase tracking-wide">
              {ctaLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {linkUrl ? <Link href={linkUrl}>{content}</Link> : content}
    </section>
  );
}
