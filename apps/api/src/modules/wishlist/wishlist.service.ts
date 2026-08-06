import { prisma } from "../../config/prisma";
import { sendMail } from "../../lib/mailer";
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
    where: { productId, alertedAt: null, priceAtAdd: { gt: newPrice } },
    include: { customer: { select: { email: true, name: true } }, product: { select: { name: true, slug: true } } },
  });
  if (items.length === 0) return;

  for (const item of items) {
    const productUrl = `${env.webOrigin}/product/${item.product.slug}`;
    const oldPrice = Number(item.priceAtAdd);
    await sendMail({
      to: item.customer.email,
      subject: `Price drop: ${item.product.name}`,
      html: `<p>Hi ${escapeHtml(item.customer.name)},</p><p><strong>${item.product.name}</strong> dropped from ৳${oldPrice} to ৳${newPrice}.</p><p><a href="${productUrl}">${productUrl}</a></p>`,
    });
  }

  await prisma.wishlistItem.updateMany({
    where: { id: { in: items.map((i) => i.id) } },
    data: { alertedAt: new Date() },
  });
}
