import type { SyncCartInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";

const ABANDONMENT_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour of inactivity

/** Full-replace upsert — the client's localStorage cart is always the source of truth; this is
 * a one-way mirror purely so cart abandonment can be detected for a logged-in customer. Never
 * read back into the storefront UI. */
export async function syncCart(customerId: string, input: SyncCartInput) {
  await prisma.$transaction(async (tx) => {
    const cart = await tx.cart.upsert({
      where: { customerId },
      create: { customerId },
      update: { reminderSentAt: null },
    });

    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    if (input.items.length > 0) {
      await tx.cartItem.createMany({
        data: input.items.map((item) => ({ cartId: cart.id, variantId: item.variantId, quantity: item.quantity })),
      });
    }

    // Bump updatedAt even when the item list is unchanged in content (e.g. quantity-only tweaks
    // already covered above) — touch explicitly since createMany/deleteMany don't touch the parent row.
    await tx.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
  });
}

/** Deletes the server-side cart mirror after a real purchase, so the recovery sweep can't fire
 * on a cart that was just bought. Safe to call for guests too (no-op if no Cart row exists). */
export async function clearCart(customerId: string) {
  await prisma.cart.deleteMany({ where: { customerId } });
}

const cartInclude = {
  customer: { select: { id: true, name: true, email: true } },
  items: {
    include: {
      variant: {
        include: { product: { include: { images: { orderBy: { sortOrder: "asc" as const }, take: 1 } } } },
      },
    },
  },
};

/** Real carts that have sat untouched past the abandonment threshold and haven't already had a
 * reminder sent for this inactivity window. */
export async function findAbandonedCarts() {
  const cutoff = new Date(Date.now() - ABANDONMENT_THRESHOLD_MS);
  return prisma.cart.findMany({
    where: { updatedAt: { lte: cutoff }, reminderSentAt: null, items: { some: {} } },
    include: cartInclude,
  });
}

export type AbandonedCart = Awaited<ReturnType<typeof findAbandonedCarts>>[number];

export async function markReminderSent(cartId: string) {
  await prisma.cart.update({ where: { id: cartId }, data: { reminderSentAt: new Date() } });
}
