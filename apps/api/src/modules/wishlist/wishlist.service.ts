import { prisma } from "../../config/prisma";

const productInclude = {
  variants: true,
  images: { orderBy: { sortOrder: "asc" as const } },
  category: true,
};

export async function listWishlist(customerId: string) {
  const items = await prisma.wishlistItem.findMany({
    where: { customerId },
    include: { product: { include: productInclude } },
    orderBy: { createdAt: "desc" },
  });
  return items;
}

export async function addToWishlist(customerId: string, productId: string) {
  return prisma.wishlistItem.upsert({
    where: { customerId_productId: { customerId, productId } },
    create: { customerId, productId },
    update: {},
  });
}

export async function removeFromWishlist(customerId: string, productId: string) {
  await prisma.wishlistItem.deleteMany({ where: { customerId, productId } });
}
