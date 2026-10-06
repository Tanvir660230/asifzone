/**
 * Loads a SAMPLE store (placeholder catalog, homepage, settings and generated placeholder images) into a LOCAL database,
 * so a storefront and its theme can be built and reviewed before the real store's content exists.
 *
 *   cd apps/api && npx tsx scripts/sample-store/load.ts nasihamart [--replace]
 *
 * Development only. It refuses NODE_ENV=production, any database not on this machine and the demo mirror (*_demo). Images
 * go through the same pipeline as an admin upload (processProductImage), so every one is replaceable through the admin.
 * `--replace` deactivates the categories and products this sample does not define (e.g. the generic seed catalog), and
 * replaces the homepage sections and hero banners. Re-running is idempotent: existing sample rows are updated.
 */
import "../../src/config/env";
import { configSchemaByType } from "@clothing-brand/shared";
import { prisma } from "../../src/config/prisma";
import { cacheDelByPrefix, redis } from "../../src/config/redis";
import { isDemoDatabase, isLoopbackHost, parseDatabaseTarget } from "../../src/config/database-guard";
import { processLogoImage, processProductImage } from "../../src/modules/uploads/upload.service";
import { rebuildAllReadModels } from "../../src/domain/storefront/read-model.service";
import { renderPlaceholder, renderPlaceholderLogo, type ArtKind } from "./placeholder-art";
import { nasihamart } from "./nasihamart.fixture";
import type { SampleStore } from "./types";

const STORES: Record<string, SampleStore> = { nasihamart };

function refuseUnlessLocal(): void {
  const target = parseDatabaseTarget(process.env.DATABASE_URL ?? "");
  const problems = [
    process.env.NODE_ENV === "production" && "NODE_ENV=production",
    !target && "DATABASE_URL is not a valid URL",
    target && !isLoopbackHost(target.host) && `database host "${target.host}" is not this machine`,
    target && isDemoDatabase(target.database) && `"${target.database}" is the demo mirror`,
  ].filter(Boolean);
  if (problems.length) {
    console.error(`[sample-store] refusing to load sample content: ${problems.join("; ")}. Sample stores are for local development only.`);
    process.exit(1);
  }
}

async function upload(kind: ArtKind, tone: string, width: number, height: number, name: string, variant = 0): Promise<string> {
  const { url } = await processProductImage(await renderPlaceholder(kind, tone, width, height, variant), name);
  return url;
}

/** Validates section config with the same schema the admin API uses — sample content can't be something the admin couldn't save. */
function sectionConfig(type: keyof typeof configSchemaByType, config: unknown) {
  return configSchemaByType[type].parse(config) as object;
}

async function main() {
  refuseUnlessLocal();
  const [storeKey, ...flags] = process.argv.slice(2);
  const store = storeKey ? STORES[storeKey] : undefined;
  if (!store) {
    console.error(`Usage: npx tsx scripts/sample-store/load.ts <${Object.keys(STORES).join("|")}> [--replace]`);
    process.exit(1);
  }
  const replace = flags.includes("--replace");

  // Store identity — the placeholder logo is a normal uploaded image, replaced in Admin → Settings.
  const logoUrl = await processLogoImage(await renderPlaceholderLogo(store.logo.wordmark));
  await prisma.storeSetting.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...store.settings, logoUrl },
    update: { ...store.settings, logoUrl },
  });

  // Categories.
  const categoryIds = new Map<string, string>();
  for (const [index, category] of store.categories.entries()) {
    const imageUrl = await upload(category.art, category.tone, 960, 1200, `${category.key}.webp`);
    const data = { name: category.name, imageUrl, imageAltText: `${category.name} (sample image)`, sortOrder: index, isActive: true, isFeatured: true, deletedAt: null };
    const row = await prisma.category.upsert({ where: { slug: category.key }, create: { slug: category.key, ...data }, update: data });
    categoryIds.set(category.key, row.id);
  }

  // Products, two images each (the second is the card's hover image).
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  for (const [index, p] of store.products.entries()) {
    const categoryId = categoryIds.get(p.category);
    if (!categoryId) throw new Error(`Unknown category "${p.category}" for ${p.slug}`);
    const images = [
      await upload(p.art, p.tone, 1200, 1200, `${p.slug}-1.webp`),
      await upload(p.art, p.tone, 1200, 1200, `${p.slug}-2.webp`, 1),
    ];
    const colors: [string, string | null][] = p.variants.colors.length ? p.variants.colors : [["", null]];
    const variants = p.variants.sizes.flatMap((size, s) =>
      colors.map(([color, colorHex], c) => ({
        sku: `SAMPLE-${p.slug.slice(0, 18).toUpperCase()}-${s}${c}`,
        size,
        color,
        colorHex,
        stock: p.variants.stock,
      })),
    );
    const fields = {
      name: p.name,
      description: p.description,
      shortDescription: p.short,
      categoryId,
      productType: p.productType,
      brand: p.brand,
      basePrice: p.price,
      compareAtPrice: p.compareAt ?? null,
      isFeatured: p.featured ?? false,
      isActive: true,
      status: "PUBLISHED" as const,
      sortOrder: index,
      deletedAt: null,
      // Spread over five weeks, so "new arrivals" and the "New" badge have something real to sort by.
      createdAt: daysAgo((index * 3) % 35),
    };
    const existing = await prisma.product.findUnique({ where: { slug: p.slug }, select: { id: true } });
    if (existing) {
      await prisma.productImage.deleteMany({ where: { productId: existing.id } });
      await prisma.productVariant.deleteMany({ where: { productId: existing.id } });
      await prisma.product.update({ where: { id: existing.id }, data: fields });
    }
    const productId = existing?.id ?? (await prisma.product.create({ data: { slug: p.slug, ...fields } })).id;
    await prisma.productImage.createMany({
      data: images.map((url, sortOrder) => ({ productId, url, altText: `${p.name} (sample image)`, width: 1200, height: 1200, sortOrder })),
    });
    await prisma.productVariant.createMany({ data: variants.map((v) => ({ ...v, productId })) });
  }

  if (replace) {
    const keepCategories = [...categoryIds.values()];
    const keepProducts = store.products.map((p) => p.slug);
    const products = await prisma.product.updateMany({ where: { slug: { notIn: keepProducts } }, data: { isActive: false } });
    const categories = await prisma.category.updateMany({ where: { id: { notIn: keepCategories } }, data: { isActive: false } });
    await prisma.banner.updateMany({ where: { placement: "HERO_CAROUSEL" }, data: { isActive: false } });
    console.log(`[sample-store] --replace: deactivated ${products.count} product(s) and ${categories.count} categor(ies) outside the sample`);
  }

  // Homepage — built only from the existing section types, in the order the storefront shows them.
  const heroImage = await upload(store.hero.art, store.hero.tone, 2400, 1350, "hero.webp");
  const storyImage = await upload(store.brandStory.art, store.brandStory.tone, 1600, 1200, "brand-story.webp");
  const promoImage = await upload(store.promoBanner.art, store.promoBanner.tone, 2400, 800, "promo.webp");
  const promoMobile = await upload(store.promoBanner.art, store.promoBanner.tone, 1200, 675, "promo-mobile.webp");
  const sections = [
    { type: "HERO" as const, config: { ...store.hero.config, imageUrl: heroImage } },
    { type: "CATEGORY_GRID" as const, config: { heading: "Shop by category" } },
    { type: "PRODUCT_CAROUSEL" as const, config: { heading: "Best sellers", subtitle: null, source: "featured", category: null, itemCount: 4 } },
    { type: "BRAND_STORY" as const, config: { ...store.brandStory.config, imageUrl: storyImage } },
    { type: "PRODUCT_CAROUSEL" as const, config: { heading: "New arrivals", subtitle: null, source: "new", category: null, itemCount: 4 } },
    { type: "PROMO_BANNER" as const, config: { ...store.promoBanner.config, imageUrl: promoImage, mobileImageUrl: promoMobile } },
    { type: "VALUES_GRID" as const, config: store.valuesGrid },
  ];
  await prisma.$transaction([
    prisma.homepageSection.deleteMany({}),
    prisma.homepageSection.createMany({
      data: sections.map((s, sortOrder) => ({ type: s.type, sortOrder, isActive: true, config: sectionConfig(s.type, s.config) })),
    }),
  ]);

  const rebuilt = await rebuildAllReadModels();
  // The shared client connects lazily and refuses commands while disconnected (config/redis.ts) — a script must connect
  // it itself, or the cache clear silently does nothing and the API keeps serving the previous homepage.
  if (redis.status === "wait") await redis.connect();
  await cacheDelByPrefix("");
  console.log(
    `[sample-store] loaded "${store.settings.storeName}" sample: ${store.categories.length} categories, ${store.products.length} products, ` +
      `${sections.length} homepage sections; read model rebuilt for ${rebuilt} product(s). Restart the web dev server to drop its data cache.`,
  );
}

main()
  .catch((err) => {
    console.error("[sample-store] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
