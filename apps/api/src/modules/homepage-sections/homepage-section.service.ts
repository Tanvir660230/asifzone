import type { CreateHomepageSectionInput, HomepageSectionType, UpdateHomepageSectionInput } from "@clothing-brand/shared";
import { configSchemaByType, REPEATABLE_SECTION_TYPES } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheDelByPrefix, cacheGet, cacheSet } from "../../config/redis";
import { AppError } from "../../lib/app-error";

const CACHE_PREFIX = "homepage-sections:";
const ACTIVE_CACHE_KEY = `${CACHE_PREFIX}active`;
const CACHE_TTL_SECONDS = 300;

async function invalidateCache() {
  await cacheDelByPrefix(CACHE_PREFIX);
}

function isSingleton(type: HomepageSectionType) {
  return !REPEATABLE_SECTION_TYPES.includes(type);
}

// Deterministic ids on the seed rows make `ensureSeeded` safe under a concurrent first request —
// two racing calls both attempt the same 9 ids, and `skipDuplicates` turns the loser into a no-op
// instead of a duplicate homepage. Order/config here reproduce the pre-builder hardcoded homepage
// exactly, so shipping this migration doesn't change anything a visitor sees.
const DEFAULT_SECTIONS: { id: string; type: HomepageSectionType; sortOrder: number; config: object }[] = [
  { id: "seed-hero", type: "HERO", sortOrder: 0, config: {} },
  {
    id: "seed-trust-strip",
    type: "TRUST_STRIP",
    sortOrder: 1,
    config: {
      items: [
        { icon: "Truck", label: "Nationwide Delivery" },
        { icon: "RotateCcw", label: "7-Day Easy Returns" },
        { icon: "ShieldCheck", label: "Authentic Quality" },
        { icon: "Banknote", label: "Cash on Delivery" },
      ],
    },
  },
  { id: "seed-personalized-lead", type: "PERSONALIZED_LEAD", sortOrder: 2, config: {} },
  {
    id: "seed-product-carousel",
    type: "PRODUCT_CAROUSEL",
    sortOrder: 3,
    config: { heading: "Featured", source: "featured", itemCount: 8 },
  },
  { id: "seed-flash-sale", type: "FLASH_SALE", sortOrder: 4, config: {} },
  { id: "seed-category-grid", type: "CATEGORY_GRID", sortOrder: 5, config: {} },
  { id: "seed-brand-story", type: "BRAND_STORY", sortOrder: 6, config: {} },
  {
    id: "seed-values-grid",
    type: "VALUES_GRID",
    sortOrder: 7,
    config: {
      items: [
        {
          icon: "Feather",
          title: "Considered Fabric",
          description:
            "Natural fibers and mill-dyed cottons, chosen for how they wear over time — not just how they photograph.",
        },
        {
          icon: "Ruler",
          title: "Fit & Finish",
          description: "Pattern-checked silhouettes and clean interior seams — details you feel more than see.",
        },
        {
          icon: "Gem",
          title: "Timeless Design",
          description: "Pieces built around a season, not a trend cycle — worth keeping well past this year.",
        },
        {
          icon: "Leaf",
          title: "Considered Sourcing",
          description: "Smaller runs, fewer offcuts, and suppliers we can actually stand behind.",
        },
      ],
    },
  },
  { id: "seed-smart-recommendations", type: "SMART_RECOMMENDATIONS", sortOrder: 8, config: {} },
];

async function ensureSeeded() {
  const count = await prisma.homepageSection.count();
  if (count > 0) return;
  await prisma.homepageSection.createMany({ data: DEFAULT_SECTIONS, skipDuplicates: true });
}

export async function listHomepageSections() {
  await ensureSeeded();
  return prisma.homepageSection.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
}

export async function getActiveHomepageSections() {
  const cached = await cacheGet<Awaited<ReturnType<typeof listHomepageSections>>>(ACTIVE_CACHE_KEY);
  if (cached) return cached;

  await ensureSeeded();
  const now = new Date();
  const sections = await prisma.homepageSection.findMany({
    where: {
      isActive: true,
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  await cacheSet(ACTIVE_CACHE_KEY, sections, CACHE_TTL_SECONDS);
  return sections;
}

async function getSectionById(id: string) {
  const section = await prisma.homepageSection.findUnique({ where: { id } });
  if (!section) throw AppError.notFound("Homepage section not found");
  return section;
}

/** Validates `config` against the schema for `type`. Lives here rather than at the route because
 * PATCH doesn't carry `type` in its body — a section's type never changes after creation, so only
 * its own existing row knows which schema applies. */
function parseConfig(type: HomepageSectionType, config: unknown) {
  const result = configSchemaByType[type].safeParse(config ?? {});
  if (!result.success) throw AppError.badRequest("Invalid section config", result.error.flatten());
  return result.data;
}

export async function createHomepageSection(input: CreateHomepageSectionInput) {
  if (isSingleton(input.type)) {
    throw AppError.badRequest(`"${input.type}" only supports a single instance — toggle or edit it instead`);
  }
  const config = parseConfig(input.type, input.config);
  const section = await prisma.homepageSection.create({
    data: { type: input.type, config, isActive: input.isActive, startsAt: input.startsAt, endsAt: input.endsAt },
  });
  await invalidateCache();
  return section;
}

export async function updateHomepageSection(id: string, input: UpdateHomepageSectionInput) {
  const existing = await getSectionById(id);
  const config = input.config === undefined ? undefined : parseConfig(existing.type, input.config);

  const section = await prisma.homepageSection.update({
    where: { id },
    data: {
      ...(config !== undefined && { config }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
      ...(input.startsAt !== undefined && { startsAt: input.startsAt }),
      ...(input.endsAt !== undefined && { endsAt: input.endsAt }),
    },
  });
  await invalidateCache();
  return section;
}

export async function reorderHomepageSections(ids: string[]) {
  const sections = await prisma.homepageSection.findMany({ select: { id: true } });
  const existingIds = new Set(sections.map((s) => s.id));
  if (ids.length !== existingIds.size || ids.some((id) => !existingIds.has(id))) {
    throw AppError.badRequest("ids must match the existing homepage sections exactly");
  }

  await prisma.$transaction(
    ids.map((id, sortOrder) => prisma.homepageSection.update({ where: { id }, data: { sortOrder } })),
  );
  await invalidateCache();
  return listHomepageSections();
}

export async function deleteHomepageSection(id: string) {
  const existing = await getSectionById(id);
  if (isSingleton(existing.type)) {
    throw AppError.badRequest(`"${existing.type}" can't be deleted — toggle it off instead`);
  }
  await prisma.homepageSection.delete({ where: { id } });
  await invalidateCache();
}
