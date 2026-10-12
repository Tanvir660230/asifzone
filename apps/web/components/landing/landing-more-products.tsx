import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Product } from "@clothing-brand/shared";
import { listStorefrontProducts } from "@/lib/api/storefront";
import { formatPrice } from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";
import { landingPagePath } from "@/lib/landing";
import { percentOffLabel, productDisplayPrice } from "@/lib/pricing-display";

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const bn = (value: number | string) => String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)]!);

/** Others from the same category first, then the newest, without the product on the page. */
async function relatedProducts(product: Product, count: number): Promise<Product[]> {
  const [sameCategory, newest] = await Promise.all([
    listStorefrontProducts({ category: product.category.slug, pageSize: count + 1 }).catch(() => ({ items: [] as Product[] })),
    listStorefrontProducts({ pageSize: count + 1 }).catch(() => ({ items: [] as Product[] })),
  ]);
  const seen = new Set([product.id]);
  const picked: Product[] = [];
  for (const p of [...sameCategory.items, ...newest.items]) {
    if (seen.has(p.id) || p.images.length === 0) continue;
    seen.add(p.id);
    picked.push(p);
    if (picked.length === count) break;
  }
  return picked;
}

/**
 * "More you may like" on an ad landing page: a shopper who wants to look around can, without leaving the one-page
 * order flow (each card opens that product's own landing page). Renders nothing when the store has nothing else to show.
 */
export async function LandingMoreProducts({ product, currency }: { product: Product; currency: string }) {
  const products = await relatedProducts(product, 6);
  if (products.length === 0) return null;
  const money = (value: string | number) => formatPrice(value, currency);

  return (
    <section aria-labelledby="more-title">
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 id="more-title" className="text-xl font-bold text-fg">
          আরও পণ্য দেখুন
        </h2>
        <Link href="/" className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-fg underline-offset-4 hover:underline">
          সব পণ্য
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3">
        {products.map((p) => {
          const shown = productDisplayPrice(p);
          const was = shown.was !== null && Number(shown.was) > Number(shown.price) ? shown.was : null;
          const off = was ? percentOffLabel(shown.price, was) : null;
          return (
            <li key={p.id}>
              <Link href={landingPagePath(p.slug)} className="group block">
                <span className="relative block aspect-[4/5] overflow-hidden rounded-xl bg-surface-muted">
                  <Image
                    src={resolveImageUrl(p.images[0]!.url)}
                    alt={p.images[0]!.altText ?? p.name}
                    fill
                    sizes="(min-width: 640px) 33vw, 50vw"
                    className="object-cover transition-transform duration-slow ease-smooth group-hover:scale-[1.03]"
                  />
                </span>
                <span className="mt-2.5 block line-clamp-2 text-sm font-medium leading-5 text-fg" lang="en">
                  {p.name}
                </span>
                <span className="mt-1 flex flex-wrap items-baseline gap-x-2">
                  <span className="text-base font-bold tabular-nums text-fg">{money(shown.price)}</span>
                  {was && <span className="text-xs tabular-nums text-fg-muted line-through">{money(was)}</span>}
                  {off && <span className="text-xs font-semibold text-sale-600">{bn(off)}% ছাড়</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
