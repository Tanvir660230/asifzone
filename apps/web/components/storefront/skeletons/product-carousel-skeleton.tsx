import { ProductCardSkeleton } from "./product-card-skeleton";

/** Matches ProductCarousel's own heading + horizontal-scroll-row shape — was defined locally on
 * the product page (one skeleton per Suspense-streamed recommendation rail); also used by the
 * homepage's client-personalized rails (PersonalizedLeadSection, SmartRecommendations) to reserve
 * their eventual height during the localStorage/fetch resolution window, instead of popping the
 * whole section in and shifting everything below it once real products arrive. */
export function ProductCarouselSkeleton() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-6 h-6 w-48 animate-pulse rounded bg-ink-100" />
      <div className="flex gap-4 overflow-x-hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="w-[45vw] shrink-0 sm:w-56">
            <ProductCardSkeleton />
          </div>
        ))}
      </div>
    </section>
  );
}
