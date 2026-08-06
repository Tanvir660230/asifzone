// Shapes returned by the API (JSON-serialized: Decimal/Date become strings).

export interface Category {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  imageAltText: string | null;
  bannerImageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  isFeatured: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  children?: Category[];
}

export interface AttributeValue {
  id: string;
  attributeId: string;
  value: string;
  colorHex: string | null;
  sortOrder: number;
}

export interface Attribute {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  values: AttributeValue[];
  createdAt: string;
  updatedAt: string;
}

export interface VariantAttributeValue {
  id: string;
  variantId: string;
  attributeValueId: string;
  attributeValue: AttributeValue & { attribute: Pick<Attribute, "id" | "name" | "slug"> };
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  size: string;
  color: string;
  colorHex: string | null;
  price: string | null;
  costPrice: string | null;
  stock: number;
  weight: string | null;
  imageId: string | null;
  attributeValues?: VariantAttributeValue[];
}

export interface ProductImage {
  id: string;
  productId: string;
  url: string;
  altText: string | null;
  sortOrder: number;
}

export interface ActiveFlashSale {
  flashSaleId: string;
  flashSaleName: string;
  endsAt: string;
  discountType: "PERCENTAGE" | "FIXED";
  discountValue: string;
  flashPrice: string;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  categoryId: string;
  category: Category;
  brand: string | null;
  brandTier: "PREMIUM" | "PLATINUM" | "LUXURY";
  basePrice: string;
  compareAtPrice: string | null;
  costPrice: string | null;
  taxRate: string | null;
  trackInventory: boolean;
  lowStockThreshold: number;
  restockDate: string | null;
  isActive: boolean;
  isFeatured: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  deletedAt: string | null;
  variants: ProductVariant[];
  images: ProductImage[];
  activeFlashSale?: ActiveFlashSale | null;
  createdAt: string;
  updatedAt: string;
}

/** Real, aggregate signals for a single product's PDP — never fabricated. Every field is a
 * genuine count (or null/0/false) derived from real orders, views, and stock. */
export interface UrgencySignals {
  viewsToday: number;
  recentPurchaseCount: number;
  lastPurchasedAt: string | null;
  unitsSoldLast7Days: number;
  isFastSelling: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Lightweight product shape for the search typeahead dropdown — not the full `Product`. */
export interface SearchSuggestionProduct {
  id: string;
  name: string;
  slug: string;
  price: number;
  imageUrl: string | null;
}

export interface SearchSuggestions {
  products: SearchSuggestionProduct[];
  predictions: string[];
}

/** Live product/stock info for this line item, joined in only by the customer-scoped order-detail
 * lookup (powers "Reorder") — null when the variant/product no longer exists or is unavailable. */
export interface OrderItemLiveInfo {
  productId: string;
  productSlug: string;
  productName: string;
  imageUrl: string | null;
  price: number;
  maxStock: number;
}

export interface OrderItem {
  id: string;
  orderId: string;
  variantId: string;
  productNameSnapshot: string;
  skuSnapshot: string;
  sizeSnapshot: string;
  colorSnapshot: string;
  priceSnapshot: string;
  quantity: number;
  live?: OrderItemLiveInfo | null;
}

export interface ReturnRequest {
  id: string;
  orderId: string;
  customerId: string;
  reason: string;
  note: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  adminNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  order?: Pick<Order, "id" | "orderNumber" | "status" | "total" | "createdAt">;
  customer?: { name: string; email: string };
}

export interface OrderStatusHistoryEntry {
  id: string;
  orderId: string;
  status: Order["status"];
  note: string | null;
  changedByAdminId: string | null;
  changedByAdmin: { name: string } | null;
  createdAt: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string | null;
  status:
    | "PENDING"
    | "CONFIRMED"
    | "PROCESSING"
    | "PACKED"
    | "SHIPPED"
    | "DELIVERED"
    | "CANCELLED"
    | "RETURNED"
    | "REFUNDED";
  paymentMethod: "COD" | "SSLCOMMERZ";
  paymentStatus: "UNPAID" | "PAID" | "FAILED" | "REFUNDED";
  customerName: string;
  customerEmail: string | null;
  customerPhone: string;
  shippingDivision: string;
  shippingDistrict: string;
  shippingArea: string;
  shippingAddressLine: string;
  subtotal: string;
  discount: string;
  shippingFee: string;
  total: string;
  couponId: string | null;
  bundleId: string | null;
  bundleDiscount: string;
  notes: string | null;
  adminNotes: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  statusHistory: OrderStatusHistoryEntry[];
  items: OrderItem[];
  returnRequests?: ReturnRequest[];
  createdAt: string;
  updatedAt: string;
}

export interface FlashSaleItem {
  id: string;
  flashSaleId: string;
  productId: string;
  product?: Product;
  discountType: "PERCENTAGE" | "FIXED";
  discountValue: string;
  stockLimit: number | null;
}

export interface FlashSale {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  bannerImageUrl: string | null;
  items: FlashSaleItem[];
  createdAt: string;
  updatedAt: string;
}

export interface Coupon {
  id: string;
  code: string;
  type: "PERCENTAGE" | "FIXED";
  value: string;
  minOrderAmount: string | null;
  maxDiscountAmount: string | null;
  usageLimit: number | null;
  usedCount: number;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BundleSuggestion {
  id: string;
  bundleId: string;
  categoryId: string;
  category: Category;
  sortOrder: number;
}

export interface Bundle {
  id: string;
  name: string;
  anchorCategoryId: string;
  anchorCategory: Category;
  discountType: "PERCENTAGE" | "FIXED";
  discountValue: string;
  minSuggestedCategories: number;
  isActive: boolean;
  sortOrder: number;
  suggestions: BundleSuggestion[];
  createdAt: string;
  updatedAt: string;
}

/** Bundle + the live products (drawn from its suggestion categories) for a given anchor product's PDP. */
export interface BundleForProduct {
  bundle: Bundle;
  suggestedProducts: Product[];
}

/** One candidate bundle's standing against the current cart — `eligible` tells whether `discount`
 * is actually unlocked; `missingCategories` are the suggestion categories still needed. */
export interface BundleMatch {
  bundle: Bundle;
  matchedCategoryIds: string[];
  missingCategories: Category[];
  eligible: boolean;
  discount: number;
}

/** The best already-unlocked bundle discount for the cart (if any) plus the closest "add one
 * more thing" nudge (if any) — the cart/checkout preview response. */
export interface BundleCartPreview {
  eligible: BundleMatch | null;
  nearMiss: BundleMatch | null;
}

export interface Redirect {
  id: string;
  fromPath: string;
  toPath: string;
  statusCode: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Address {
  id: string;
  customerId: string;
  label: string | null;
  fullName: string;
  phone: string;
  division: string;
  district: string;
  area: string;
  addressLine: string;
  isDefault: boolean;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  emailVerifiedAt: string | null;
  phone: string | null;
  smsMarketingOptIn: boolean;
  rewardPoints: number;
  createdAt: string;
  updatedAt: string;
}

export interface RewardPointsEntry {
  id: string;
  customerId: string;
  points: number;
  reason: string;
  orderId: string | null;
  createdAt: string;
}

export interface WishlistItem {
  id: string;
  customerId: string;
  productId: string;
  product: Product;
  createdAt: string;
}

export interface AdminCustomerListItem extends Customer {
  _count: { orders: number; wishlistItems: number };
}

export interface AdminCustomerDetail extends Customer {
  addresses: Address[];
  orders: Order[];
  wishlistItems: (Omit<WishlistItem, "product"> & { product: Pick<Product, "id" | "name" | "slug"> })[];
  pointsLedger: RewardPointsEntry[];
  totalSpent: number;
}

export interface StoreSettings {
  id: string;
  storeName: string;
  tagline: string | null;
  logoUrl: string | null;
  logoOnDarkUrl: string | null;
  faviconUrl: string | null;
  currency: string;
  contactEmail: string | null;
  contactPhone: string | null;
  shippingFeeDhaka: string;
  shippingFeeOutsideDhaka: string;
  taxEnabled: boolean;
  defaultTaxRate: string | null;
  rewardPointsPerCurrency: string;
  updatedAt: string;
}

export interface SocialLink {
  id: string;
  platform: "FACEBOOK" | "INSTAGRAM" | "YOUTUBE" | "TIKTOK" | "LINKEDIN" | "X" | "WHATSAPP" | "OTHER";
  url: string;
  label: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationEntry {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  adminId: string | null;
  admin: { name: string; email: string } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface Banner {
  id: string;
  placement: "HERO_CAROUSEL" | "PROMO_STRIP";
  imageUrl: string;
  mobileImageUrl: string | null;
  linkUrl: string | null;
  title: string | null;
  subtitle: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PushSubscriptionSummary {
  id: string;
  endpoint: string;
  createdAt: string;
}

export interface Segment {
  id: string;
  name: string;
  filter: { type: string };
  createdAt: string;
  updatedAt: string;
}

export interface CampaignRecipientCounts {
  PENDING: number;
  SENT: number;
  FAILED: number;
}

export interface Campaign {
  id: string;
  name: string;
  channel: "EMAIL" | "SMS" | "PUSH";
  status: "DRAFT" | "SCHEDULED" | "SENDING" | "SENT" | "FAILED";
  subject: string | null;
  body: string;
  segmentId: string | null;
  segment: Segment | null;
  scheduledAt: string | null;
  sentAt: string | null;
  recipientCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignDetail extends Campaign {
  recipientCounts: CampaignRecipientCounts;
}
