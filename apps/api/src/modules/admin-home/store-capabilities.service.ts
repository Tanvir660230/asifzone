import { prisma } from "../../config/prisma";

/**
 * What this store actually does, read from its own data (owner decision Q-G, 27 Oct 2026): the admin shows Production only
 * when the admin has the permission AND the store has production — materials, a recipe, a production order or a
 * fill-to-order product. Data, not a store name, decides, so any store that starts making things gets the page and one
 * that never did (no recipes) doesn't. Visibility only: the manufacturing API enforces its own permissions either way,
 * and nothing is hidden from a store that has production records.
 */
export interface StoreCapabilities {
  production: boolean;
}

export async function storeCapabilities(): Promise<StoreCapabilities> {
  const [material, fillToOrder, recipe, run] = await Promise.all([
    prisma.product.findFirst({ where: { kind: "MATERIAL", deletedAt: null }, select: { id: true } }),
    prisma.product.findFirst({ where: { fillToOrder: true, deletedAt: null }, select: { id: true } }),
    prisma.billOfMaterials.findFirst({ select: { id: true } }),
    prisma.productionOrder.findFirst({ select: { id: true } }),
  ]);
  return { production: Boolean(material || fillToOrder || recipe || run) };
}
