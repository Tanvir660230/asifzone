import { prisma } from "../../config/prisma";
import { sendMail } from "../../lib/mailer";
import { renderEmailLayout } from "../../lib/email-template";
import { env } from "../../config/env";
import { escapeHtml } from "../../lib/html";

const productInclude = {
  variants: true,
  images: { orderBy: { sortOrder: "asc" as const } },
  category: true,
};

export async function listWishlist(customerId: string) {
  const items = await prisma.wishlistItem.findMany({
    where: { customerId },
    include: { product: { include: productInclude } },
    orderBy: { createdAt: "desc" },
  });
  return items;
}

export async function addToWishlist(customerId: string, productId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { basePrice: true } });
  return prisma.wishlistItem.upsert({
    where: { customerId_productId: { customerId, productId } },
    // priceAtAdd is the real baseline a future price drop is measured against — captured once,
    // at the moment of wishlisting, not touched on repeat adds (upsert's update leaves it alone).
    create: { customerId, productId, priceAtAdd: product?.basePrice ?? null },
    update: {},
  });
}

export async function removeFromWishlist(customerId: string, productId: string) {
  await prisma.wishlistItem.deleteMany({ where: { customerId, productId } });
}

/** Fire-and-forget from product.service.ts when a product's basePrice decreases. Emails every
 * real wishlister whose captured priceAtAdd is now higher than the new price, once each. */
export async function notifyPriceDrop(productId: string, newPrice: number) {
  const items = await prisma.wishlistItem.findMany({
    // Only customers with an email on file can be notified this way — phone-only guests/customers
    // just never get picked up here (no per-item try/catch below, so this must be filtered up front).
    where: { productId, alertedAt: null, priceAtAdd: { gt: newPrice }, customer: { email: { not: null } } },
    include: { customer: { select: { email: true, name: true } }, product: { select: { name: true, slug: true } } },
  });
  if (items.length === 0) return;

  // Per-item isolation: one bad address/transient send failure must not stop the rest of the
  // batch, and must not block `alertedAt` from being set on the ones that *did* go out — otherwise
  // every already-emailed customer gets re-spammed on the next price-drop trigger for this product.
  const sentIds: string[] = [];
  for (const item of items) {
    try {
      const productUrl = `${env.webOrigin}/product/${item.product.slug}`;
      const oldPrice = Number(item.priceAtAdd);
      await sendMail({
        // Non-null by the query filter above — Prisma's include type just can't express that.
        to: item.customer.email!,
        subject: `Price drop: ${item.product.name}`,
        html: renderEmailLayout({
          bodyHtml: `
            <p style="margin:0 0 4px;">
              <span style="display:inline-block;background-color:#e53935;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;padding:4px 10px;border-radius:999px;">Price drop</span>
            </p>
            <p style="margin:14px 0 8px;font-size:18px;font-weight:600;">${escapeHtml(item.product.name)}</p>
            <p style="margin:0;">Hi ${escapeHtml(item.customer.name)}, an item on your wishlist just got cheaper:</p>
            <p style="margin:10px 0 0;">
              <span style="font-size:20px;font-weight:700;color:#111111;">৳${newPrice}</span>
              <span style="font-size:14px;color:#999999;text-decoration:line-through;margin-left:8px;">৳${oldPrice}</span>
            </p>
          `,
          ctaLabel: "View product",
          ctaUrl: productUrl,
        }),
      });
      sentIds.push(item.id);
    } catch (err) {
      console.error(`[price-drop] failed to notify wishlist item ${item.id}:`, err);
    }
  }

  if (sentIds.length) {
    await prisma.wishlistItem.updateMany({ where: { id: { in: sentIds } }, data: { alertedAt: new Date() } });
  }
}
