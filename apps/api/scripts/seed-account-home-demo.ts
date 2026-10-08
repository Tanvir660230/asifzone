/**
 * Local-only demo data for designing the account home (docs/ACCOUNT_HOME.md): one customer with an order in progress,
 * past orders, a saved address, wishlist items, store balance and points. Refuses to run against a production database.
 *
 *   DATABASE_URL=<a local scratch DB> LIVE_PROVIDERS=off npx tsx scripts/seed-account-home-demo.ts
 */
import bcrypt from "bcryptjs";
import { prisma } from "../src/config/prisma";
import { createOrder } from "../src/modules/orders/order.service";

const EMAIL = "account.demo@example.com";
const PASSWORD = "AccountDemo123!";

async function main() {
  if (process.env.NODE_ENV === "production" || !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Local databases only");
  }
  await prisma.customer.deleteMany({ where: { email: EMAIL } }).catch(() => undefined);

  const customer = await prisma.customer.create({
    data: {
      name: "Nadia Rahman",
      email: EMAIL,
      phone: "01712345678",
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      rewardPoints: 340,
      createdAt: new Date("2024-03-12T10:00:00Z"),
    },
  });

  await prisma.address.create({
    data: {
      customerId: customer.id,
      label: "Home",
      fullName: "Nadia Rahman",
      phone: "01712345678",
      division: "Dhaka",
      district: "Dhaka",
      area: "Dhanmondi",
      addressLine: "House 12, Road 5",
      isDefault: true,
    },
  });

  const products = await prisma.product.findMany({
    where: { isActive: true, deletedAt: null, images: { some: {} }, variants: { some: { isActive: true, stock: { gt: 3 } } } },
    include: { variants: { where: { isActive: true, stock: { gt: 3 } }, take: 1 } },
    take: 8,
  });
  if (products.length < 4) throw new Error("Need at least 4 stocked products with images");

  const place = async (variantIds: string[], status: string, daysAgo: number) => {
    const order = await createOrder({
      items: variantIds.map((variantId) => ({ variantId, quantity: 1 })),
      customerName: "Nadia Rahman",
      customerPhone: "01712345678",
      shippingDivision: "Dhaka",
      shippingDistrict: "Dhaka",
      shippingArea: "Dhanmondi",
      shippingAddressLine: "House 12, Road 5",
      paymentMethod: "COD",
    } as never);
    const createdAt = new Date(Date.now() - daysAgo * 86_400_000);
    await prisma.order.update({ where: { id: order.id }, data: { customerId: customer.id, status: status as never, createdAt } });
    return order;
  };

  await place([products[3]!.variants[0]!.id, products[4]!.variants[0]!.id, products[5]!.variants[0]!.id], "DELIVERED", 68);
  const returned = await place([products[2]!.variants[0]!.id], "DELIVERED", 14);
  await place([products[1]!.variants[0]!.id], "DELIVERED", 11);
  await place([products[0]!.variants[0]!.id, products[6]!.variants[0]!.id], "PACKED", 3);

  await prisma.customerCreditEntry.create({
    data: {
      customerId: customer.id,
      type: "RETURN",
      amount: 1250,
      currency: "BDT",
      reason: "Returned items",
      orderId: returned.id,
      sourceType: "demo",
      sourceId: returned.id,
      idempotencyKey: `demo-credit-${customer.id}`,
    },
  });
  await prisma.rewardPointsEntry.createMany({
    data: [
      { customerId: customer.id, points: 220, reason: "Points for a delivered order" },
      { customerId: customer.id, points: 120, reason: "Points for a delivered order" },
    ],
  });
  await prisma.wishlistItem.createMany({
    data: products.slice(4, 8).map((p) => ({ customerId: customer.id, productId: p.id })),
    skipDuplicates: true,
  });

  console.log(`Seeded ${EMAIL} / ${PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
