import type { PublicProductFamily } from "@clothing-brand/shared";

export interface FamilyTile {
  productId: string;
  /** Where the tile goes; null for the product being viewed (it is the chosen tile, not a link). */
  href: string | null;
  label: string;
  imageUrl: string | null;
  current: boolean;
  unavailable: boolean;
}

/**
 * The tiles a product page draws for one family, in the admin's order — or null when there is nothing to choose: the
 * family has fewer than two members on sale, or the viewed product isn't one of them (it was unpublished meanwhile).
 */
export function familyTiles(family: PublicProductFamily, currentProductId: string): FamilyTile[] | null {
  if (family.members.length < 2 || !family.members.some((m) => m.productId === currentProductId)) return null;
  return family.members.map((m) => {
    const current = m.productId === currentProductId;
    return {
      productId: m.productId,
      href: current ? null : `/product/${encodeURIComponent(m.slug)}`,
      label: m.label,
      imageUrl: m.imageUrl,
      current,
      unavailable: !m.available,
    };
  });
}
