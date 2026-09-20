/// <reference types="node" />
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

/** Comprehensive demo products across all categories and sections so a fresh database is fully populated
 * and ready for storefront browsing, featured carousels, flash sales, and e2e testing. */
async function seedDemoCatalog() {
  // Categories
  const tshirtsCat = await prisma.category.upsert({
    where: { slug: "t-shirts" },
    update: {},
    create: { name: "T-Shirts & Apparel", slug: "t-shirts" },
  });

  const fragrancesCat = await prisma.category.upsert({
    where: { slug: "fragrances" },
    update: {},
    create: { name: "Fragrances & Attar", slug: "fragrances" },
  });

  const watchesCat = await prisma.category.upsert({
    where: { slug: "watches" },
    update: {},
    create: { name: "Luxury Watches", slug: "watches" },
  });

  const islamicCat = await prisma.category.upsert({
    where: { slug: "islamic-products" },
    update: {},
    create: { name: "Islamic Products", slug: "islamic-products" },
  });

  const shoesCat = await prisma.category.upsert({
    where: { slug: "shoes" },
    update: {},
    create: { name: "Footwear & Shoes", slug: "shoes" },
  });

  const accessoriesCat = await prisma.category.upsert({
    where: { slug: "accessories" },
    update: {},
    create: { name: "Accessories", slug: "accessories" },
  });

  const homeCat = await prisma.category.upsert({
    where: { slug: "home-decor" },
    update: {},
    create: { name: "Home & Living", slug: "home-decor" },
  });

  const demoProducts = [
    {
      name: "Classic Cotton Tee",
      slug: "classic-cotton-tee",
      description: "A soft, breathable everyday cotton t-shirt.",
      categoryId: tshirtsCat.id,
      productType: "CLOTHING" as const,
      basePrice: 1200,
      isFeatured: true,
      brandTier: "PREMIUM" as const,
      variants: [
        { sku: "DEMO-TEE-S-WHT", size: "S", color: "White", colorHex: "#FFFFFF", stock: 50 },
        { sku: "DEMO-TEE-M-BLK", size: "M", color: "Black", colorHex: "#000000", stock: 50 },
      ],
    },
    {
      name: "Royal Oud Attar",
      slug: "royal-oud-attar",
      description: "Rich, long-lasting oriental fragrance with notes of agarwood and amber.",
      categoryId: fragrancesCat.id,
      productType: "FRAGRANCE" as const,
      basePrice: 2500,
      isFeatured: true,
      brandTier: "LUXURY" as const,
      variants: [
        { sku: "DEMO-OUD-12ML", size: "12ml", color: "Gold", colorHex: "#D4AF37", stock: 30 },
        { sku: "DEMO-OUD-50ML", size: "50ml", color: "Crystal", colorHex: "#E5E4E2", stock: 15 },
      ],
    },
    {
      name: "Minimalist Chronograph Watch",
      slug: "minimalist-chronograph-watch",
      description: "Sleek stainless steel watch with a genuine leather strap.",
      categoryId: watchesCat.id,
      productType: "WATCH" as const,
      basePrice: 4500,
      isFeatured: true,
      brandTier: "PLATINUM" as const,
      variants: [
        { sku: "DEMO-WATCH-BLK-SLV", size: "Standard", color: "Black/Silver", colorHex: "#2C2C2C", stock: 25 },
      ],
    },
    {
      name: "Premium Velvet Prayer Mat (Janamaz)",
      slug: "premium-velvet-prayer-mat",
      description: "Plush, cushioned Islamic prayer rug with intricate Anatolian motifs.",
      categoryId: islamicCat.id,
      productType: "ISLAMIC_PRODUCT" as const,
      basePrice: 1800,
      isFeatured: true,
      brandTier: "PREMIUM" as const,
      variants: [
        { sku: "DEMO-MAT-EMR", size: "Standard", color: "Emerald Green", colorHex: "#50C878", stock: 60 },
      ],
    },
    {
      name: "Minimalist Leather Sneaker",
      slug: "minimalist-leather-sneaker",
      description: "Handcrafted full-grain leather sneakers for all-day comfort.",
      categoryId: shoesCat.id,
      productType: "SHOES" as const,
      basePrice: 3800,
      isFeatured: true,
      brandTier: "PLATINUM" as const,
      variants: [
        { sku: "DEMO-SHOE-42-WHT", size: "42", color: "White", colorHex: "#FFFFFF", stock: 25 },
      ],
    },
    {
      name: "Genuine Leather Minimalist Wallet",
      slug: "genuine-leather-wallet",
      description: "Slim RFID-blocking bifold wallet crafted from vegetable-tanned leather.",
      categoryId: accessoriesCat.id,
      productType: "ACCESSORY" as const,
      basePrice: 950,
      isFeatured: true,
      brandTier: "PREMIUM" as const,
      variants: [
        { sku: "DEMO-WAL-TAN", size: "One Size", color: "Tan", colorHex: "#D2B48C", stock: 50 },
      ],
    },
    {
      name: "Aromatherapy Ceramic Diffuser",
      slug: "aromatherapy-ceramic-diffuser",
      description: "Ultrasonic essential oil diffuser with ambient LED lighting for home relaxation.",
      categoryId: homeCat.id,
      productType: "HOME" as const,
      basePrice: 2200,
      isFeatured: true,
      brandTier: "PREMIUM" as const,
      variants: [
        { sku: "DEMO-DIFF-WHT", size: "Standard", color: "Matte White", colorHex: "#F8F8F8", stock: 35 },
      ],
    },
  ];

  for (const productData of demoProducts) {
    const { variants, ...prodFields } = productData;
    const existing = await prisma.product.findUnique({ where: { slug: prodFields.slug } });
    if (!existing) {
      await prisma.product.create({
        data: {
          ...prodFields,
          variants: { create: variants },
        },
      });
    }
  }

  console.log(`Seeded demo catalog with ${demoProducts.length} products across all sections and categories.`);
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
    // A phone on file matters here specifically because checkout prefills customerPhone from it
    // (see checkout/page.tsx's reset() on login) — leaving it null on the one account QA/demo
    // scripts actually log in as made every checkout look like the prefill was broken.
    data: { name: "Demo Customer", email, phone: "01799999999", passwordHash },
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
