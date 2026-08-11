import Link from "next/link";
import type { FlashSale } from "@clothing-brand/shared";
import { ProductGrid } from "./product-grid";
import { CountdownTimer } from "./countdown-timer";

export function FlashSaleSection({ flashSale }: { flashSale: FlashSale }) {
  const products = flashSale.items.map((item) => item.product).filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (products.length === 0) return null;

  return (
    <section className="bg-ink-950 py-16 text-cream-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-sale-500">Limited Time</p>
            <h2 className="font-display text-2xl">{flashSale.name}</h2>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-sale-500 px-4 py-2 text-sale-500">
            <span className="text-xs uppercase tracking-wide">Ends in</span>
            <CountdownTimer endsAt={flashSale.endsAt} className="font-display text-lg" />
          </div>
        </div>

        <div className="[&_h3]:text-cream-50 [&_p]:text-cream-300">
          <ProductGrid products={products} />
        </div>

        <div className="mt-8 text-center">
          <Link href="/search" className="text-sm uppercase tracking-wide text-cream-100 underline hover:text-white">
            View all deals
          </Link>
        </div>
      </div>
    </section>
  );
}
