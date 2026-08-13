import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { computeFlashPrice, getActiveFlashInfoByProduct, type ActiveFlashInfo } from "../flash-sales/flash-sale-pricing";

export interface CartLine {
  variantId: string;
  productId: string;
  categoryId: string;
  quantity: number;
  lineTotal: number;
}

async function fetchVariants(variantIds: string[]) {
  return prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    include: { product: true },
  });
}

type CartVariant = Awaited<ReturnType<typeof fetchVariants>>[number];

/** A running flash sale overrides everything else — it's already the "this is the price right now" figure. */
export function effectivePrice(variant: CartVariant, flashByProduct: Map<string, ActiveFlashInfo>): number {
  const regularPrice = variant.price !== null ? Number(variant.price) : Number(variant.product.basePrice);
  const flash = flashByProduct.get(variant.productId);
  return flash ? computeFlashPrice(regularPrice, flash) : regularPrice;
}

/** Resolves cart items into priced, catalog-trusted lines — the one place variantId -> product/category/
 * price is looked up, so coupon product/category targeting never trusts a client-supplied productId.
 * Shared by order creation (which also reuses `variantById` for its own stock/active checks and
 * order-item snapshots) and the public coupon validate/best-coupon endpoints. */
export async function resolveCartLines(items: Array<{ variantId: string; quantity: number }>) {
  const variantIds = items.map((i) => i.variantId);
  const variants = await fetchVariants(variantIds);
  if (variants.length !== new Set(variantIds).size) {
    throw AppError.badRequest("One or more items in your cart are no longer available");
  }

  const variantById = new Map(variants.map((v) => [v.id, v]));
  const flashByProduct = await getActiveFlashInfoByProduct(variants.map((v) => v.productId));

  let subtotal = 0;
  const lines: CartLine[] = items.map((item) => {
    const variant = variantById.get(item.variantId)!;
    const lineTotal = effectivePrice(variant, flashByProduct) * item.quantity;
    subtotal += lineTotal;
    return {
      variantId: item.variantId,
      productId: variant.productId,
      categoryId: variant.product.categoryId,
      quantity: item.quantity,
      lineTotal,
    };
  });

  return { subtotal, lines, variantById, flashByProduct };
}
