import type { MetadataRoute } from "next";
import { getCategoryTree, listStorefrontProducts } from "@/lib/api/storefront";

function flattenCategories(nodes: Awaited<ReturnType<typeof getCategoryTree>>["tree"]): { slug: string }[] {
  return nodes.flatMap((node) => [{ slug: node.slug }, ...flattenCategories(node.children)]);
}

async function fetchAllProductSlugs(): Promise<string[]> {
  const slugs: string[] = [];
  const pageSize = 100;

  for (let page = 1; page <= 20; page++) {
    const result = await listStorefrontProducts({ page, pageSize });
    slugs.push(...result.items.map((p) => p.slug));
    if (result.items.length < pageSize) break;
  }
  return slugs;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const [{ tree }, productSlugs] = await Promise.all([getCategoryTree(), fetchAllProductSlugs()]);
  const categories = flattenCategories(tree);

  return [
    { url: siteUrl, changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl}/search`, changeFrequency: "daily", priority: 0.5 },
    ...categories.map((c) => ({
      url: `${siteUrl}/category/${c.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...productSlugs.map((slug) => ({
      url: `${siteUrl}/product/${slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
