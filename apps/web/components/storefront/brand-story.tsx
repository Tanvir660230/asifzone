import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { SectionAppearance } from "@clothing-brand/shared";
import { resolveImageUrl } from "@/lib/image-url";
import { bandTone } from "@/lib/band-tone";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";

interface BrandStoryProps {
  storeName: string;
  tagline?: string | null;
  eyebrow?: string | null;
  heading?: string | null;
  bodyText?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  imageUrl?: string | null;
  imageAltText?: string | null;
  /** The store's own choice for this section (Storefront Studio → Style); absent = the theme decides. */
  tone?: SectionAppearance["tone"];
  layout?: SectionAppearance["layout"];
}

/** The brand's own statement, set as an editorial band: large left-aligned type, and with a photograph a split layout
 * (copy beside the image from 1024px, on the side the store picks) or the photograph behind the copy (`backdrop`). The
 * copy is the store's own words, or the store name and tagline; nothing is invented. The band is a `.ui-band-inverse`
 * section, so a theme — or the store, per section — may render it light. */
export function BrandStory({ storeName, tagline, eyebrow, heading, bodyText, ctaLabel, ctaHref, imageUrl, imageAltText, tone, layout }: BrandStoryProps) {
  const title = heading || tagline || storeName;
  const alt = imageAltText || title;
  const copy = (
    <>
      <p className="mb-5 text-xs ui-eyebrow text-[color:var(--band-accent,rgb(var(--color-brass-300)))]">{eyebrow || "Our Philosophy"}</p>
      <h2 className="font-display text-4xl leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">{title}</h2>
      {bodyText && <p className="mt-6 max-w-[52ch] text-base leading-relaxed text-ink-300">{bodyText}</p>}
      <Link
        href={ctaHref || "/search"}
        className="group mt-10 inline-flex h-12 items-center gap-2 rounded-[var(--control-radius)] bg-cream-50 px-7 text-sm font-medium text-ink-950 transition-transform duration-200 ease-smooth hover:-translate-y-px active:translate-y-0 active:scale-[0.98]"
      >
        {ctaLabel || "Explore the collection"}
        <ArrowRight size={16} aria-hidden="true" className="transition-transform duration-200 ease-smooth group-hover:translate-x-0.5" />
      </Link>
    </>
  );

  // The photograph fills the band and the copy sits on the theme's media scrim — always the dark palette, so the type
  // reads on any picture.
  if (imageUrl && layout === "backdrop") {
    return (
      <section data-band="story" data-tone="dark" className="ui-band-inverse relative isolate overflow-hidden bg-ink-950 text-cream-50">
        <Image src={resolveImageUrl(imageUrl)} alt={alt} fill sizes="100vw" className="-z-10 object-cover" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[color:var(--media-scrim)]" />
        <div className="mx-auto flex min-h-[32rem] max-w-7xl items-center px-4 py-[calc(6rem*var(--section-rhythm))] sm:px-6 lg:min-h-[38rem] lg:px-8">
          <Reveal className="max-w-2xl">{copy}</Reveal>
        </div>
      </section>
    );
  }

  return (
    <section data-band="story" data-tone={bandTone(tone)} className="ui-band-inverse overflow-hidden bg-ink-950 text-cream-50">
      <div
        className={
          imageUrl
            ? "mx-auto grid max-w-7xl items-center gap-10 px-4 py-[calc(5rem*var(--section-rhythm))] sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8"
            : "mx-auto max-w-7xl px-4 py-[calc(6rem*var(--section-rhythm))] sm:px-6 lg:px-8"
        }
      >
        <Reveal className={imageUrl ? "" : "max-w-3xl"}>{copy}</Reveal>
        {imageUrl && (
          <Reveal
            index={1}
            className={cn("relative aspect-[4/5] w-full overflow-hidden rounded-2xl sm:aspect-[5/4] lg:aspect-[4/5]", layout === "image-left" && "lg:order-first")}
          >
            <Image src={resolveImageUrl(imageUrl)} alt={alt} fill sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
          </Reveal>
        )}
      </div>
    </section>
  );
}
