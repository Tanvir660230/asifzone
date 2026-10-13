import { ProductCardSkeleton } from "./product-card-skeleton";

/** Matches ProductCarousel's own heading + horizontal-scroll-row shape — was defined locally on
 * the product page (one skeleton per Suspense-streamed recommendation rail); also used by the
 * homepage's client-personalized rails (PersonalizedLeadSection, SmartRecommendations) to reserve
 * their eventual height during the localStorage/fetch resolution window, instead of popping the
 * whole section in and shifting everything below it once real products arrive. */
export function ProductCarouselSkeleton() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-6 h-6 w-48 rounded ui-skeleton" />
      {/* Same card widths as ProductCarousel's rail, so the real row replaces this without a shift. */}
      <div className="flex gap-3 overflow-x-hidden sm:gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="w-[calc((100%-0.75rem)/1.75)] shrink-0 sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]">
            <ProductCardSkeleton />
          </div>
        ))}
      </div>
    </section>
  );
}
