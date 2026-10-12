import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { resolveImageUrl } from "@/lib/image-url";
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
}

/** The brand's own statement, set as an editorial band: large left-aligned type, and with a photograph a split layout
 * (copy beside the image from 1024px). The copy is the store's own words, or the store name and tagline; nothing is
 * invented. The band is a `.ui-band-inverse` section, so a theme may render it light. */
export function BrandStory({ storeName, tagline, eyebrow, heading, bodyText, ctaLabel, ctaHref, imageUrl }: BrandStoryProps) {
  return (
    <section data-band="story" className="ui-band-inverse overflow-hidden bg-ink-950 text-cream-50">
      <div
        className={
          imageUrl
            ? "mx-auto grid max-w-7xl items-center gap-10 px-4 py-[calc(5rem*var(--section-rhythm))] sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8"
            : "mx-auto max-w-7xl px-4 py-[calc(6rem*var(--section-rhythm))] sm:px-6 lg:px-8"
        }
      >
        <Reveal className={imageUrl ? "" : "max-w-3xl"}>
          <p className="mb-5 text-xs ui-eyebrow text-[color:var(--band-accent,rgb(var(--color-brass-300)))]">{eyebrow || "Our Philosophy"}</p>
          <h2 className="font-display text-4xl leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">{heading || tagline || storeName}</h2>
          {bodyText && <p className="mt-6 max-w-[52ch] text-base leading-relaxed text-ink-300">{bodyText}</p>}
          <Link
            href={ctaHref || "/search"}
            className="group mt-10 inline-flex h-12 items-center gap-2 rounded-[var(--control-radius)] bg-cream-50 px-7 text-sm font-medium text-ink-950 transition-transform duration-200 ease-smooth hover:-translate-y-px active:translate-y-0 active:scale-[0.98]"
          >
            {ctaLabel || "Explore the collection"}
            <ArrowRight size={16} aria-hidden="true" className="transition-transform duration-200 ease-smooth group-hover:translate-x-0.5" />
          </Link>
        </Reveal>
        {/* The photograph's width and height are theme tokens (a small vignette, or a large editorial photograph). */}
        {imageUrl && (
          <Reveal index={1} className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl sm:aspect-[5/4] lg:aspect-[4/5]">
            <Image src={resolveImageUrl(imageUrl)} alt={heading || storeName} fill sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
          </Reveal>
        )}
      </div>
    </section>
  );
}
