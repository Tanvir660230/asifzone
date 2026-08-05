import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin already exists: ${email}`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.adminUser.create({
    data: { name: "Store Owner", email, passwordHash, role: "OWNER" },
  });

  console.log(`Created admin user: ${email} / ${password} (change this password after first login)`);
}

/** A minimal demo product (with variants) so a fresh database isn't completely empty — CI's
 * integration/e2e tests need at least one real product to exist, and it doubles as something to
 * click through when manually verifying a fresh deploy. Idempotent: safe to run repeatedly. */
async function seedDemoCatalog() {
  const existingProduct = await prisma.product.findUnique({ where: { slug: "classic-cotton-tee" } });
  if (existingProduct) {
    console.log("Demo catalog already seeded");
    return;
  }

  const category = await prisma.category.upsert({
    where: { slug: "t-shirts" },
    update: {},
    create: { name: "T-Shirts", slug: "t-shirts" },
  });

  await prisma.product.create({
    data: {
      name: "Classic Cotton Tee",
      slug: "classic-cotton-tee",
      description: "A soft, breathable everyday cotton t-shirt.",
      categoryId: category.id,
      basePrice: 1200,
      isFeatured: true,
      variants: {
        create: [
          { sku: "DEMO-TEE-S-WHT", size: "S", color: "White", colorHex: "#FFFFFF", stock: 50 },
          { sku: "DEMO-TEE-M-BLK", size: "M", color: "Black", colorHex: "#000000", stock: 50 },
        ],
      },
    },
  });

  console.log("Seeded demo category + product (Classic Cotton Tee)");
}

/** A demo customer so the admin Customers list (and anything that assumes at least one exists,
 * e.g. the e2e suite) isn't relying on some other test/spec having registered one first. */
async function seedDemoCustomer() {
  const email = "demo.customer@example.com";
  const existing = await prisma.customer.findUnique({ where: { email } });
  if (existing) {
    console.log("Demo customer already seeded");
    return;
  }

  const passwordHash = await bcrypt.hash("DemoCustomer123!", 12);
  await prisma.customer.create({
    data: { name: "Demo Customer", email, passwordHash },
  });

  console.log(`Seeded demo customer: ${email}`);
}

async function main() {
  await seedAdmin();
  await seedDemoCatalog();
  await seedDemoCustomer();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
