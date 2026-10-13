import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";

interface RichTextSectionProps {
  eyebrow?: string | null;
  heading: string;
  bodyText?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  align?: "start" | "center";
}

/** A short editorial text block (RICH_TEXT): a statement, an announcement, a delivery or sizing note. Line breaks the
 * store typed are kept. Left-aligned on the page frame by default, or centred in a reading column. */
export function RichTextSection({ eyebrow, heading, bodyText, ctaLabel, ctaHref, align = "start" }: RichTextSectionProps) {
  const center = align === "center";
  return (
    <section className="mx-auto max-w-7xl px-4 py-[calc(3.5rem*var(--section-rhythm))] sm:px-6 sm:py-[calc(5rem*var(--section-rhythm))] lg:px-8">
      <Reveal className={cn("max-w-3xl", center && "mx-auto text-center")}>
        {eyebrow && <p className="mb-3 text-xs ui-eyebrow text-fg-muted">{eyebrow}</p>}
        <h2 className="text-balance font-display text-3xl leading-[1.15] text-fg sm:text-4xl">{heading}</h2>
        {bodyText && <p className={cn("mt-5 whitespace-pre-line text-base leading-relaxed text-fg-muted", center && "mx-auto max-w-[60ch]")}>{bodyText}</p>}
        {ctaLabel && ctaHref && (
          <Link href={ctaHref} className={cn(buttonVariants({ variant: "primary", size: "lg" }), "mt-8 rounded-[var(--control-radius)]")}>
            {ctaLabel}
          </Link>
        )}
      </Reveal>
    </section>
  );
}
