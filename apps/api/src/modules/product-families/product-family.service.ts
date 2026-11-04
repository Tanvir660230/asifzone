import { Prisma } from "@prisma/client";
import {
  distinctNames,
  isAvailable,
  type ProductFamilyDetail,
  type ProductFamilySummary,
  type PublicProductFamily,
  type SaveProductFamily,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { recordAudit } from "../../lib/audit";
import { priceProductsForDisplay } from "../../domain/pricing/pricing.service";

/* Product families (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §3). A family only stores links (family id, product id,
   order, optional label): no product, variant, price or stock row is ever written here. */

const firstImage = { orderBy: { sortOrder: "asc" as const }, take: 1, select: { url: true, altText: true } };

const memberInclude = {
  members: {
    orderBy: { sortOrder: "asc" as const },
    include: { product: { select: { id: true, name: true, slug: true, status: true, deletedAt: true, images: firstImage } } },
  },
} satisfies Prisma.ProductFamilyInclude;

type FamilyRow = Prisma.ProductFamilyGetPayload<{ include: typeof memberInclude }>;

function detail(row: FamilyRow): ProductFamilyDetail {
  return {
    id: row.id,
    name: row.name,
    updatedAt: row.updatedAt.toISOString(),
    members: row.members.map((m) => ({
      productId: m.productId,
      name: m.product.name,
      slug: m.product.slug,
      status: m.product.deletedAt ? "TRASHED" : m.product.status,
      imageUrl: m.product.images[0]?.url ?? null,
      label: m.label,
    })),
  };
}

/** Every member exists, is not in Trash and is something the store sells (not a material). */
async function assertMembers(input: SaveProductFamily) {
  const ids = input.members.map((m) => m.productId);
  const rows = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, kind: true, deletedAt: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const p = byId.get(id);
    if (!p || p.deletedAt) throw AppError.badRequest("One of the products doesn't exist or is in Trash — remove it from the family");
    if (p.kind !== "FINISHED") throw AppError.badRequest(`“${p.name}” is a material — only products the store sells can be in a family`);
  }
}

const memberRows = (input: SaveProductFamily) => input.members.map((m, i) => ({ productId: m.productId, sortOrder: i, label: m.label?.trim() || null }));

async function load(id: string): Promise<FamilyRow> {
  const row = await prisma.productFamily.findUnique({ where: { id }, include: memberInclude });
  if (!row) throw AppError.notFound("Product family not found");
  return row;
}

export async function listProductFamilies(): Promise<ProductFamilySummary[]> {
  const rows = await prisma.productFamily.findMany({ include: memberInclude, orderBy: { updatedAt: "desc" } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    memberCount: r.members.length,
    imageUrls: r.members.flatMap((m) => (m.product.images[0] ? [m.product.images[0].url] : [])).slice(0, 4),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function getProductFamily(id: string): Promise<ProductFamilyDetail> {
  return detail(await load(id));
}

export async function createProductFamily(input: SaveProductFamily, adminId: string, ip?: string): Promise<ProductFamilyDetail> {
  await assertMembers(input);
  const row = await prisma.productFamily.create({
    data: { name: input.name.trim(), createdById: adminId, updatedById: adminId, members: { create: memberRows(input) } },
    include: memberInclude,
  });
  recordAudit({ adminId, action: "product_family.created", entityType: "ProductFamily", entityId: row.id, metadata: { name: row.name, members: row.members.length }, ipAddress: ip });
  return detail(row);
}

export async function updateProductFamily(id: string, input: SaveProductFamily, adminId: string, ip?: string): Promise<ProductFamilyDetail> {
  await load(id);
  await assertMembers(input);
  const row = await prisma.$transaction(async (tx) => {
    await tx.productFamilyMember.deleteMany({ where: { familyId: id } });
    return tx.productFamily.update({
      where: { id },
      data: { name: input.name.trim(), updatedById: adminId, members: { create: memberRows(input) } },
      include: memberInclude,
    });
  });
  recordAudit({ adminId, action: "product_family.updated", entityType: "ProductFamily", entityId: id, metadata: { name: row.name, members: row.members.length }, ipAddress: ip });
  return detail(row);
}

export async function deleteProductFamily(id: string, adminId: string, ip?: string): Promise<void> {
  const row = await load(id);
  await prisma.productFamily.delete({ where: { id } });
  recordAudit({ adminId, action: "product_family.deleted", entityType: "ProductFamily", entityId: id, metadata: { name: row.name }, ipAddress: ip });
}

/**
 * The families a product page shows: every family the product is in, with only the members on sale (published, not in
 * Trash, a finished good), in the admin's order. A family left with fewer than two such members is not sent. Prices are
 * the server's (the same resolver every quote uses); `available` = some active variant can be ordered now.
 */
export async function familiesForProduct(productId: string): Promise<PublicProductFamily[]> {
  const families = await prisma.productFamily.findMany({
    where: { members: { some: { productId } } },
    orderBy: { createdAt: "asc" },
    include: {
      members: {
        orderBy: { sortOrder: "asc" },
        where: { product: { status: "PUBLISHED", isActive: true, deletedAt: null, kind: "FINISHED" } },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              basePrice: true,
              compareAtPrice: true,
              trackInventory: true,
              markedSoldOut: true,
              images: firstImage,
              variants: { where: { isActive: true }, select: { id: true, price: true, compareAtPrice: true, isActive: true, stock: true, markedSoldOut: true } },
            },
          },
        },
      },
    },
  });
  const shown = families.filter((f) => f.members.length >= 2 && f.members.some((m) => m.productId === productId));
  if (!shown.length) return [];

  const products = [...new Map(shown.flatMap((f) => f.members.map((m) => [m.productId, m.product] as const))).values()];
  const pricing = await priceProductsForDisplay(products);

  return shown.map((f) => {
    const names = distinctNames(f.members.map((m) => m.product.name));
    return {
      id: f.id,
      name: f.name,
      members: f.members.map((m, i) => {
        const p = m.product;
        const available = !p.markedSoldOut && p.variants.some((v) => !v.markedSoldOut && isAvailable(p.trackInventory, v.stock));
        return {
          productId: p.id,
          slug: p.slug,
          label: m.label || names[i]!,
          imageUrl: p.images[0]?.url ?? null,
          imageAlt: p.images[0]?.altText ?? null,
          price: pricing.get(p.id)?.from ?? Number(p.basePrice),
          available,
        };
      }),
    };
  });
}
