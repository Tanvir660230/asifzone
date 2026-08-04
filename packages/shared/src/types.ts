// Shapes returned by the API (JSON-serialized: Decimal/Date become strings).

export interface Category {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  children?: Category[];
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  size: string;
  color: string;
  colorHex: string | null;
  price: string | null;
  stock: number;
  weight: string | null;
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
  brandTier: "PREMIUM" | "PLATINUM" | "LUXURY";
  basePrice: string;
  compareAtPrice: string | null;
  isActive: boolean;
  isFeatured: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  variants: ProductVariant[];
  images: ProductImage[];
  activeFlashSale?: ActiveFlashSale | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
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
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string | null;
  status: "PENDING" | "CONFIRMED" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "REFUNDED";
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
  notes: string | null;
  items: OrderItem[];
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
  phone: string | null;
  createdAt: string;
  updatedAt: string;
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
