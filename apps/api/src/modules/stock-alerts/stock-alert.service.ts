import { prisma } from "../../config/prisma";
import { sendMail } from "../../lib/mailer";
import { env } from "../../config/env";

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
    where: { variantId, notifiedAt: null },
    include: {
      customer: { select: { email: true, name: true } },
      variant: { include: { product: true } },
    },
  });
  if (alerts.length === 0) return;

  for (const alert of alerts) {
    const productUrl = `${env.webOrigin}/product/${alert.variant.product.slug}`;
    await sendMail({
      to: alert.customer.email,
      subject: `Back in stock: ${alert.variant.product.name}`,
      html: `<p>Hi ${alert.customer.name},</p><p><strong>${alert.variant.product.name}</strong> (${alert.variant.size}/${alert.variant.color}) is back in stock.</p><p><a href="${productUrl}">${productUrl}</a></p>`,
    });
  }

  await prisma.stockAlert.updateMany({
    where: { id: { in: alerts.map((a) => a.id) } },
    data: { notifiedAt: new Date() },
  });
}
