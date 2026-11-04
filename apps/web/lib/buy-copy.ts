/*
 * The product page's buying words — size, colour, quantity, the buttons, stock and delivery lines — in one place, so the
 * product page, its sticky bar and its options popup always agree. The website speaks English (owner, 2026-11-04), so
 * these are English; the ad landing pages (components/landing) speak Bangla with their own copy. One language per page.
 */

/** A variant dimension's label as the shopper reads it: the product type's own label ("Size", "Volume", "Design"), or
 * the plain word when the type names none. */
export function dimensionLabel(label: string | undefined, field: "size" | "color"): string {
  const own = label?.trim();
  if (own) return own;
  return field === "size" ? BUY.size : BUY.color;
}

export const BUY = {
  size: "Size",
  color: "Color",
  quantity: "Qty",
  addToCart: "Add to Cart",
  buyNow: "Buy Now",
  /** The Tahafi sticky capsule's one action. */
  orderNow: "Order now",
  soldOut: "Sold out",
  fewLeft: "Few left",
  fewLeftTag: "Few left",
  fewLeftUrgent: "Only a few left — order soon",
  limited: "Limited stock — order soon",
  inStock: "In stock — ready to ship",
  sizeChart: "Size guide",
  sizeChartNote: (unit: string | undefined) => `All measurements are in ${unit || "inches"}. Fit varies slightly by style — when between sizes, we recommend sizing up.`,
  chooseOptions: "Choose your options",
  /** "Please select a size to continue", "Please select a size and color to continue". */
  choose: (...labels: string[]) => `Please select a ${labels.map((l) => l.toLowerCase()).join(" and ")} to continue`,
  unavailableCombo: "This combination isn't available — please choose another",
  usualSize: "You usually take",
  decrease: "Decrease quantity",
  increase: "Increase quantity",
  deliveryEstimate: "Order today, estimated delivery",
  insideDhaka: "Inside Dhaka",
  outsideDhaka: "Elsewhere",
  deliveryFee: (fee: string) => `${fee} delivery`,
  freeDelivery: "Free delivery",
  /** Only some variants ship free: "Free delivery on M, L". */
  freeDeliveryOn: (variants: string) => `Free delivery on ${variants}`,
  whatsappOrder: "Order on WhatsApp",
  expectedBack: (date: string) => `Expected back in stock: ${date}`,
  percentOff: (percent: number | string) => `${percent}% off`,
  /** A family's tile that is sold out: struck through, still a link (read by screen readers). */
  familySoldOut: "sold out",
} as const;
