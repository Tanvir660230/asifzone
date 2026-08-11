import { prisma } from "../../config/prisma";
import { sendMail } from "../../lib/mailer";
import { renderEmailLayout } from "../../lib/email-template";
import { env } from "../../config/env";
import { escapeHtml } from "../../lib/html";

export async function subscribe(customerId: string, variantId: string) {
  await prisma.stockAlert.upsert({
    where: { customerId_variantId: { customerId, variantId } },
    create: { customerId, variantId },
    update: { notifiedAt: null },
  });
}

export async function unsubscribe(customerId: string, variantId: string) {
  await prisma.stockAlert.deleteMany({ where: { customerId, variantId } });
}

/** Fire-and-forget from product.service.ts when a variant's stock goes 0 -> positive. Emails
 * every real subscriber once, then marks them notified so they're not emailed again for the
 * same restock (re-subscribing after it sells out again resets `notifiedAt` via `subscribe`). */
export async function notifyBackInStock(variantId: string) {
  const alerts = await prisma.stockAlert.findMany({
    // Only customers with an email on file can be notified this way — phone-only guests/customers
    // just never get picked up here (no per-item try/catch below, so this must be filtered up front).
    where: { variantId, notifiedAt: null, customer: { email: { not: null } } },
    include: {
      customer: { select: { email: true, name: true } },
      variant: { include: { product: true } },
    },
  });
  if (alerts.length === 0) return;

  // Per-item isolation — see the identical comment in wishlist.service.ts's notifyPriceDrop: a
  // failed send must not block `notifiedAt` on alerts that already succeeded.
  const notifiedIds: string[] = [];
  for (const alert of alerts) {
    try {
      const productUrl = `${env.webOrigin}/product/${alert.variant.product.slug}`;
      await sendMail({
        // Non-null by the query filter above — Prisma's include type just can't express that.
        to: alert.customer.email!,
        subject: `Back in stock: ${alert.variant.product.name}`,
        html: renderEmailLayout({
          bodyHtml: `
            <p style="margin:0 0 8px;font-size:18px;font-weight:600;">Back in stock</p>
            <p style="margin:0;">Hi ${escapeHtml(alert.customer.name)}, good news — <strong>${escapeHtml(alert.variant.product.name)}</strong> (${escapeHtml(alert.variant.size)}/${escapeHtml(alert.variant.color)}) is available again.</p>
          `,
          ctaLabel: "Shop now",
          ctaUrl: productUrl,
        }),
      });
      notifiedIds.push(alert.id);
    } catch (err) {
      console.error(`[stock-alert] failed to notify alert ${alert.id}:`, err);
    }
  }

  if (notifiedIds.length) {
    await prisma.stockAlert.updateMany({ where: { id: { in: notifiedIds } }, data: { notifiedAt: new Date() } });
  }
}
