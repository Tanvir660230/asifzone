import Link from "next/link";
import type { PublicProductFamily } from "@clothing-brand/shared";
import { BUY } from "@/lib/buy-copy";
import { familyTiles } from "@/lib/product-family";
import { PHOTO_TILE_WIDTH, PhotoTileBody } from "./photo-tile";

/**
 * A product family on the product page (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §3): the family's name, then one photo
 * tile per member on sale — the current product chosen, every other one a link to its own product page. A sold-out
 * member stays (struck through), so the shopper sees the whole series. A family with nothing else to show draws nothing.
 */
export function ProductFamilyPicker({ family, currentProductId }: { family: PublicProductFamily; currentProductId: string }) {
  const tiles = familyTiles(family, currentProductId);
  if (!tiles) return null;
  const headingId = `family-${family.id}`;
  return (
    <section aria-labelledby={headingId} data-testid="product-family">
      <h2 id={headingId} className="mb-2.5 text-xs ui-caps text-ink-500">
        {family.name}
      </h2>
      <ul className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 pt-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">
        {tiles.map((t) => {
          const body = <PhotoTileBody imageUrl={t.imageUrl} label={t.label} selected={t.current} unavailable={t.unavailable} unavailableText={BUY.familySoldOut} />;
          return (
            <li key={t.productId} className={PHOTO_TILE_WIDTH}>
              {t.href ? (
                // scroll={false}: switching to a sibling keeps the shopper where they are, as switching a colour would.
                <Link href={t.href} scroll={false} className="block rounded-lg transition-transform duration-base active:scale-[0.97]" data-testid="family-tile">
                  {body}
                </Link>
              ) : (
                <span aria-current="page" className="block">
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
