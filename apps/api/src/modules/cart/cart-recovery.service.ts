import crypto from "crypto";
import { prisma } from "../../config/prisma";
import { sendMail } from "../../lib/mailer";
import { env } from "../../config/env";
import { escapeHtml } from "../../lib/html";
import { getSimilarProducts } from "../products/product.service";
import { findAbandonedCarts, markReminderSent, type AbandonedCart } from "./cart.service";

const COUPON_VALUE_PERCENT = 10;
const COUPON_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const COUPON_CODE_ATTEMPTS = 3;

function formatPrice(amount: unknown): string {
  return `৳${Number(amount)}`;
}

/** A single-use, time-limited, real Coupon row — reuses the existing coupon model/evaluation
 * engine as-is (apps/api/src/modules/coupons/coupon.service.ts). Not customer-bound (the
 * Coupon model has no such field), but single-use + emailed privately makes that a reasonable
 * simplification: whoever redeems it first uses it up. */
async function generateRecoveryCoupon(): Promise<string> {
  for (let attempt = 0; attempt < COUPON_CODE_ATTEMPTS; attempt++) {
    const code = `WELCOME10-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    try {
      await prisma.coupon.create({
        data: {
          code,
          type: "PERCENTAGE",
          value: COUPON_VALUE_PERCENT,
          usageLimit: 1,
          expiresAt: new Date(Date.now() + COUPON_EXPIRY_MS),
          isActive: true,
        },
      });
      return code;
    } catch {
      // unique code collision — vanishingly rare, just retry
    }
  }
  throw new Error("Could not generate a unique recovery coupon code");
}

async function buildAlternativesHtml(cart: AbandonedCart): Promise<string> {
  const sections: string[] = [];
  for (const item of cart.items) {
    const product = item.variant.product;
    const isLowStock = item.variant.stock === 0 || item.variant.stock <= product.lowStockThreshold;
    if (!isLowStock) continue;

    const alternatives = await getSimilarProducts(product.id, 2);
    if (alternatives.length === 0) continue;

    const links = alternatives
      .map((alt) => `<li><a href="${env.webOrigin}/product/${alt.slug}">${alt.name}</a> — ${formatPrice(alt.basePrice)}</li>`)
      .join("");
    sections.push(`<p>${product.name} is running low — you might also like:</p><ul>${links}</ul>`);
  }
  return sections.join("");
}

async function sendCartRecoveryEmail(cart: AbandonedCart): Promise<void> {
  const itemsHtml = cart.items
    .map((item) => {
      const product = item.variant.product;
      const price = Number(item.variant.price ?? product.basePrice);
      return `<li>${product.name} (${item.variant.size}/${item.variant.color}) × ${item.quantity} — ${formatPrice(price * item.quantity)}</li>`;
    })
    .join("");

  const couponCode = await generateRecoveryCoupon();
  const alternativesHtml = await buildAlternativesHtml(cart);
  const cartUrl = `${env.webOrigin}/cart`;

  try {
    await sendMail({
      to: cart.customer.email,
      subject: "You left something in your cart",
      html: `
        <p>Hi ${escapeHtml(cart.customer.name)},</p>
        <p>You left these items in your cart:</p>
        <ul>${itemsHtml}</ul>
        <p>Use code <strong>${couponCode}</strong> for ${COUPON_VALUE_PERCENT}% off if you check out within 7 days.</p>
        ${alternativesHtml}
        <p><a href="${cartUrl}">${cartUrl}</a></p>
      `,
    });
  } catch (err) {
    // The coupon had to be minted before we knew the send would work (its code goes in the body).
    // If the send fails, deactivate it immediately rather than leaving a live, redeemable,
    // never-delivered coupon behind — a persistently-failing address would otherwise accumulate
    // one every cron run (every 15 minutes) forever. The cart stays un-reminded, so a fresh coupon
    // is minted and tried again on the next sweep.
    await prisma.coupon.update({ where: { code: couponCode }, data: { isActive: false } }).catch(() => {});
    throw err;
  }

  await markReminderSent(cart.id);
}

/** The abandoned-cart sweep — called on a schedule from cart-recovery-cron.ts. */
export async function runCartRecoverySweep(): Promise<number> {
  const abandoned = await findAbandonedCarts();
  let sent = 0;
  for (const cart of abandoned) {
    try {
      await sendCartRecoveryEmail(cart);
      sent++;
    } catch (err) {
      console.error(`[cart-recovery] failed for cart ${cart.id}:`, err);
    }
  }
  return sent;
}
