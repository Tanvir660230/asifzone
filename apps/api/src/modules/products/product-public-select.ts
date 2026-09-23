/**
 * What a customer (or an anonymous visitor) may read of a product and its variants. Prisma's `include` returns *every*
 * scalar of a relation, so any public read that used `variants: true` or `include: { variants }` also returned each
 * variant's `costPrice`, and `include: { product }` returned the product's `costPrice` and `taxRate` — the shop's margin.
 * Public and customer-facing reads must go through these lists instead, and add a column here only when a storefront
 * screen actually renders it.
 *
 * (An explicit `select` rather than Prisma's `omit`, which needs a preview client feature this project doesn't enable.)
 */

/** Every ProductVariant scalar except `costPrice`. */
export const PUBLIC_VARIANT_FIELDS = {
  id: true,
  productId: true,
  sku: true,
  barcode: true,
  size: true,
  sizeLabel: true,
  color: true,
  colorHex: true,
  price: true,
  compareAtPrice: true,
  stock: true,
  weight: true,
  isActive: true,
  imageId: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Every Product scalar the storefront renders — not `costPrice` or `taxRate`, which are internal-only figures. */
export const PUBLIC_PRODUCT_SCALARS = {
  id: true,
  name: true,
  slug: true,
  description: true,
  shortDescription: true,
  sortOrder: true,
  categoryId: true,
  productType: true,
  attributes: true,
  brand: true,
  brandTier: true,
  basePrice: true,
  compareAtPrice: true,
  trackInventory: true,
  lowStockThreshold: true,
  restockDate: true,
  isActive: true,
  isFeatured: true,
  seoTitle: true,
  seoDescription: true,
  deletedAt: true,
  avgRating: true,
  reviewCount: true,
  createdAt: true,
  updatedAt: true,
} as const;
