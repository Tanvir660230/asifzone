/** Whether a variant can be bought right now, as far as the catalog is concerned: its product is published
 * (`isActive` mirrors status === PUBLISHED), not in Trash, and the variant itself is active. Stock is a separate
 * question (inventory). The one definition every purchase path uses — see TARGET_ARCHITECTURE §16a. */
export function isPurchasable(
  product: { isActive: boolean; deletedAt: Date | string | null },
  variant?: { isActive: boolean } | null,
): boolean {
  return product.isActive && product.deletedAt === null && (variant ? variant.isActive : true);
}
