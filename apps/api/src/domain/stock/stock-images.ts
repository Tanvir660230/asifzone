/**
 * The picture beside an item on the stock page: the size's own image, else the product's first image — the rule the
 * stock levels page uses. Null when it has none (materials usually); the page then shows the kind's icon.
 */
import { prisma } from "../../config/prisma";

export async function imagesFor(variantIds: string[]): Promise<Map<string, string>> {
  if (!variantIds.length) return new Map();
  const rows = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, image: { select: { url: true } }, product: { select: { images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } } } } },
  });
  const out = new Map<string, string>();
  for (const r of rows) {
    const url = r.image?.url ?? r.product.images[0]?.url;
    if (url) out.set(r.id, url);
  }
  return out;
}
