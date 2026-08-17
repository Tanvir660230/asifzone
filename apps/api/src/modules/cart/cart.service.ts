import type { SyncCartInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";

export const ABANDONMENT_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour of inactivity

/** Full-replace upsert — the client's localStorage cart is always the source of truth; this is
 * a one-way mirror purely so cart abandonment can be detected for a logged-in customer. Never
 * read back into the storefront UI. */
export async function syncCart(customerId: string, input: SyncCartInput) {
  await prisma.$transaction(async (tx) => {
    const cart = await tx.cart.upsert({
      where: { customerId },
      create: { customerId },
      update: {},
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

/** Deletes the server-side cart mirror after a real purchase, so it no longer shows up as
 * abandoned. Safe to call for guests too (no-op if no Cart row exists). */
export async function clearCart(customerId: string) {
  await prisma.cart.deleteMany({ where: { customerId } });
}

