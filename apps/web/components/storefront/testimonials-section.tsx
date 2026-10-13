import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import type { FeaturedReview } from "@clothing-brand/shared";
import { StarRating } from "./star-rating";
import { Reveal } from "./reveal";

interface TestimonialsSectionProps {
  eyebrow?: string | null;
  heading?: string | null;
  reviews: FeaturedReview[];
}

/** What customers said (TESTIMONIALS): the store's real, approved reviews — never written by the store. A swipeable
 * row on phones, three columns from 1024px. Renders nothing until the store has reviews to show. */
export function TestimonialsSection({ eyebrow, heading, reviews }: TestimonialsSectionProps) {
  if (reviews.length === 0) return null;
  const average = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  return (
    <section className="py-[calc(3.5rem*var(--section-rhythm))] sm:py-[calc(5rem*var(--section-rhythm))]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-3 text-xs ui-eyebrow text-fg-muted">{eyebrow || "Customer reviews"}</p>
            <h2 className="ui-section-heading font-display text-fg">{heading || "What our customers say"}</h2>
          </div>
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <StarRating value={average} size={16} />
            <span className="tabular-nums">{average.toFixed(1)} average</span>
          </p>
        </Reveal>
        <ul tabIndex={0} className="ui-rail -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0 lg:grid lg:grid-cols-3 lg:gap-6 lg:overflow-visible">
          {reviews.map((review, i) => (
            <Reveal
              as="li"
              key={review.id}
              index={i % 3}
              className="ui-panel flex w-[82vw] max-w-sm shrink-0 snap-start flex-col rounded-xl bg-surface p-6 sm:w-[22rem] lg:w-auto lg:max-w-none"
            >
              <StarRating value={review.rating} size={15} />
              {review.title && <p className="mt-4 font-medium text-fg">{review.title}</p>}
              <blockquote className="mt-3 line-clamp-6 flex-1 text-sm leading-relaxed text-fg-muted">“{review.body}”</blockquote>
              <div className="mt-6 border-t border-line-subtle pt-4 text-sm">
                <p className="flex items-center gap-1.5 font-medium text-fg">
                  {review.customerName}
                  {review.isVerifiedPurchase && (
                    <span className="inline-flex items-center gap-1 text-xs font-normal text-fg-muted">
                      <BadgeCheck size={14} aria-hidden="true" /> Verified buyer
                    </span>
                  )}
                </p>
                <Link href={`/product/${review.productSlug}`} className="mt-1 block truncate text-fg-muted underline-offset-4 hover:text-fg hover:underline">
                  {review.productName}
                </Link>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
