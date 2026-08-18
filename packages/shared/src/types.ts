// Shapes returned by the API (JSON-serialized: Decimal/Date become strings).

// CustomerTag is exported from schemas/customer.ts (derived from customerTagEnum) — imported here
// rather than redeclared, to avoid a duplicate-export collision via the package's barrel index.ts.
import type { CustomerTag } from "./schemas/customer";
import type { HomepageSectionType } from "./schemas/homepage-section";

export interface StockMovement {
  id: string;
  variantId: string;
  change: number;
  reason: "ORDER" | "RESTOCK" | "ADJUSTMENT" | "RETURN";
  orderId: string | null;
  adminId: string | null;
  note: string | null;
  createdAt: string;
  variant?: {
    sku: string;
    size: string;
    color: string;
    product: { id: string; name: string; slug: string };
  };
  admin?: { name: string } | null;
}

export interface StockDiscrepancy {
  variantId: string;
  sku: string;
  productName: string;
  currentStock: number;
  ledgerSum: number;
}

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
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  children?: Category[];
}

export interface CategoryStockStat {
  totalProducts: number;
  inStockProducts: number;
  totalStock: number;
}

export interface CategoryStockOverview {
  total: CategoryStockStat;
  subcategories: (CategoryStockStat & { id: string; name: string; slug: string })[];
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
  sizeLabel: string | null;
  color: string;
  colorHex: string | null;
  price: string | null;
  costPrice: string | null;
  stock: number;
  weight: string | null;
  imageId: string | null;
  sortOrder: number;
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
  shortDescription: string | null;
  sortOrder: number;
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
  avgRating: number;
  reviewCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductReview {
  id: string;
  productId: string;
  customerId: string;
  customerName: string;
  rating: number;
  title: string | null;
  body: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  isVerifiedPurchase: boolean;
  createdAt: string;
  updatedAt: string;
  product?: { id: string; name: string; slug: string };
}

export interface RatingBreakdown {
  average: number;
  count: number;
  counts: Record<"5" | "4" | "3" | "2" | "1", number>;
}

/** Real, aggregate signals for a single product's PDP — never fabricated. Every field is a
 * genuine count (or null/0/false) derived from real orders, views, and stock. */
export interface UrgencySignals {
  totalViews: number;
  recentPurchaseCount: number;
  unitsSoldLast7Days: number;
  isFastSelling: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** listStorefrontProducts's result — a plain PaginatedResult plus a spelling-correction guess,
 * populated only when a text search came back completely empty (see product.service.ts). Kept as
 * its own type rather than widening the generic PaginatedResult, which every other paginated list
 * in the app (orders, customers, coupons, ...) also uses and has no business knowing about search. */
export interface StorefrontProductResult extends PaginatedResult<Product> {
  didYouMean?: string;
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
  didYouMean?: string;
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
  returnedQuantity: number;
  live?: OrderItemLiveInfo | null;
}

export interface ReturnRequest {
  id: string;
  orderId: string;
  customerId: string;
  reason: string;
  note: string | null;
  type: "RETURN" | "EXCHANGE";
  orderItemId: string | null;
  originalSizeSnapshot: string | null;
  originalColorSnapshot: string | null;
  requestedVariantId: string | null;
  requestedSizeSnapshot: string | null;
  requestedColorSnapshot: string | null;
  exchangeOrderId: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  adminNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  order?: Pick<Order, "id" | "orderNumber" | "status" | "total" | "createdAt">;
  customer?: { name: string; email: string | null };
  exchangeOrder?: Pick<Order, "id" | "orderNumber" | "status" | "total" | "createdAt"> | null;
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

export interface Refund {
  id: string;
  orderId: string;
  paymentId: string | null;
  // Prisma Decimal serializes over JSON as a string, same convention as Order.total/subtotal/discount
  // below — not a number.
  amount: string;
  reason: string | null;
  method: string | null;
  status: "REQUESTED" | "COMPLETED";
  requestedByAdminId: string | null;
  requestedByAdmin?: { name: string } | null;
  completedAt: string | null;
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
    | "PARTIALLY_DELIVERED"
    | "CANCELLED"
    | "RETURNED"
    | "REFUNDED";
  paymentMethod: "COD" | "SSLCOMMERZ" | "EPS_PG";
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
  priceAdjustment: string;
  total: string;
  couponId: string | null;
  bundleId: string | null;
  bundleDiscount: string;
  notes: string | null;
  adminNotes: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  courierConsignmentId: string | null;
  courierStatus: string | null;
  courierTrackingLink: string | null;
  courierBookedAt: string | null;
  partialDeliveryReconciledAt: string | null;
  followUpAt: string | null;
  callAttempts: number;
  statusHistory: OrderStatusHistoryEntry[];
  items: OrderItem[];
  returnRequests?: ReturnRequest[];
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What the admin orders list table shows in its Product column — the first line item plus how
 * many more, so the table can name/link the product without paying for a full items+images join
 * on every row. `productId`/`productSlug`/`imageUrl` are null when the underlying variant or
 * product no longer exists (e.g. deleted since the order was placed). */
export interface OrderListItemSummary {
  totalItems: number;
  /** Null only if the order somehow has zero line items. */
  firstItem: {
    name: string;
    size: string;
    color: string;
    quantity: number;
    productId: string | null;
    productSlug: string | null;
    imageUrl: string | null;
  } | null;
}

export interface AdminOrderListItem extends Order {
  itemsSummary: OrderListItemSummary;
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

export interface CouponProduct {
  id: string;
  couponId: string;
  productId: string;
  product?: Product;
}

export interface CouponCategory {
  id: string;
  couponId: string;
  categoryId: string;
  category?: Category;
}

export interface Coupon {
  id: string;
  code: string;
  type: "PERCENTAGE" | "FIXED" | "FREE_SHIPPING";
  value: string | null;
  scope: "ALL_PRODUCTS" | "SPECIFIC_PRODUCTS" | "SPECIFIC_CATEGORIES";
  products: CouponProduct[];
  categories: CouponCategory[];
  minOrderAmount: string | null;
  maxDiscountAmount: string | null;
  minQuantity: number | null;
  usageLimit: number | null;
  usedCount: number;
  perCustomerLimit: number | null;
  firstOrderOnly: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  description: string | null;
  isActive: boolean;
  deletedAt: string | null;
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
  // Nullable — a guest checkout with only a phone number still creates a Customer row.
  email: string | null;
  emailVerifiedAt: string | null;
  phone: string | null;
  smsMarketingOptIn: boolean;
  emailMarketingOptIn: boolean;
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

export interface FavoriteProduct {
  name: string;
  quantity: number;
}

export interface CustomerPurchaseAnalytics {
  totalOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  /** Percent of orders (0-100) that ended up RETURNED. */
  returnRate: number;
  averageOrderValue: number;
  lifetimeSpend: number;
}

export interface CustomerSmsHistoryEntry {
  id: string;
  campaignId: string;
  campaignName: string;
  body: string;
  status: "PENDING" | "SENT" | "FAILED";
  sentAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface CustomerTimelineEntry {
  type: "ORDER" | "POINTS" | "SMS";
  date: string;
  label: string;
  detail?: string;
}

/** Admin-only fields layered on top of the public Customer shape — never returned from
 * customer-facing endpoints (me/register/login), only from the /admin/* routes below. */
interface AdminCustomerFields {
  adminNotes: string | null;
  isBlocked: boolean;
  codRisk: boolean;
  totalOrders: number;
  totalSpent: number;
  lastOrderAt: string | null;
  district: string | null;
  tags: CustomerTag[];
}

export interface AdminCustomerListItem extends Customer, AdminCustomerFields {
  lastSmsSentAt: string | null;
}

export interface AdminCustomerDetail extends Customer, AdminCustomerFields {
  addresses: Address[];
  orders: Order[];
  wishlistItems: (Omit<WishlistItem, "product"> & { product: Pick<Product, "id" | "name" | "slug"> })[];
  pointsLedger: RewardPointsEntry[];
  /** Explainable reasons the SUSPICIOUS tag fired (fake-looking phone, high cancel rate, repeated
   * courier holds) — empty when clean. See computeRiskSignals in the API's customer.service.ts. */
  riskSignals: string[];
  favoriteProducts: FavoriteProduct[];
  purchaseAnalytics: CustomerPurchaseAnalytics;
  smsHistory: CustomerSmsHistoryEntry[];
  timeline: CustomerTimelineEntry[];
}

export interface SmsTemplate {
  id: string;
  name: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerStats {
  totalCustomers: number;
  newToday: number;
  newThisMonth: number;
  repeatCustomers: number;
  lifetimeRevenue: number;
  vipCustomers: number;
  suspiciousCount: number;
  codRiskCount: number;
  blockedCount: number;
  oneTimeBuyers: number;
  inactive30: number;
  inactive60: number;
  inactive90: number;
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
  courierReturnFeeDhaka: string;
  courierReturnFeeOutsideDhaka: string;
  taxEnabled: boolean;
  defaultTaxRate: string | null;
  rewardPointsPerCurrency: string;
  whatsappMessage: string | null;
  whatsappLabel: string;
  callEnabled: boolean;
  callLabel: string;
  liveChatEnabled: boolean;
  liveChatLabel: string;
  tawkPropertyId: string | null;
  tawkWidgetId: string | null;
  paymentMethodsImageUrl: string | null;
  codEnabled: boolean;
  onlinePaymentEnabled: boolean;
  epsPaymentEnabled: boolean;
  googleSiteVerification: string | null;
  updatedAt: string;
}

export interface SmsNotificationSettings {
  id: string;
  adminAlertPhones: string;
  adminOrderAlertEnabled: boolean;
  customerOrderPlacedEnabled: boolean;
  customerOrderConfirmedEnabled: boolean;
  customerOrderShippedEnabled: boolean;
  customerOrderDeliveredEnabled: boolean;
  customerOrderCancelledEnabled: boolean;
  customerPaymentConfirmedEmailEnabled: boolean;
  customerOrderPlacedTemplate: string | null;
  customerOrderConfirmedTemplate: string | null;
  customerOrderShippedTemplate: string | null;
  customerOrderDeliveredTemplate: string | null;
  customerOrderCancelledTemplate: string | null;
  updatedAt: string;
}

/** Named "...Option" since "PaymentMethod" is already the COD/SSLCOMMERZ enum type exported from
 * schemas/order.ts. */
export interface PaymentMethodOption {
  id: string;
  name: string;
  logoUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
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
  altText: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HomepageSection {
  id: string;
  type: HomepageSectionType;
  sortOrder: number;
  isActive: boolean;
  config: Record<string, unknown>;
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

export interface Feedback {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  subject: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}
