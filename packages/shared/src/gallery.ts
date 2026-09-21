/** Which product images to show for the shopper's current selection. Pure, so it is unit-tested with the API's
 * suite and used unchanged by the storefront. */

export interface GalleryImage {
  id: string;
  sortOrder: number;
}

export interface GalleryVariant {
  size: string;
  color: string;
  imageId?: string | null;
  /** The variant's own gallery, in display order. */
  images?: { imageId: string; sortOrder: number }[];
}

const ownImageIds = (v: GalleryVariant): string[] => {
  if (v.images?.length) return [...v.images].sort((a, b) => a.sortOrder - b.sortOrder).map((i) => i.imageId);
  return v.imageId ? [v.imageId] : [];
};

/**
 * - the exact variant (size + colour) if it has its own images, else any variant of the chosen colour that has some;
 * - then the product's *shared* images (assigned to no variant), so a lifestyle shot still appears with every colour;
 * - nothing chosen yet, or no variant of that colour has images → the whole gallery, unchanged.
 */
export function pickGalleryImages<T extends GalleryImage>(
  images: T[],
  variants: GalleryVariant[],
  selection: { size?: string | null; color?: string | null },
): T[] {
  const ordered = [...images].sort((a, b) => a.sortOrder - b.sortOrder);
  if (!selection.color) return ordered;

  const ofColor = variants.filter((v) => v.color === selection.color);
  const exact = selection.size ? ofColor.find((v) => v.size === selection.size) : undefined;
  const chosen = (exact && ownImageIds(exact).length ? exact : ofColor.find((v) => ownImageIds(v).length > 0)) ?? null;
  if (!chosen) return ordered;

  const byId = new Map(ordered.map((i) => [i.id, i]));
  const assignedToAny = new Set(variants.flatMap(ownImageIds));
  const own = ownImageIds(chosen).map((id) => byId.get(id)).filter((i): i is T => Boolean(i));
  const shared = ordered.filter((i) => !assignedToAny.has(i.id));
  const result = [...own, ...shared.filter((s) => !own.includes(s))];
  return result.length ? result : ordered;
}
