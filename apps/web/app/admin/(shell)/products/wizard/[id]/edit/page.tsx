import { redirect } from "next/navigation";
import { productEditHref } from "@/lib/admin-routes";

/** The Product Builder moved to /admin/products/:id/edit; old links (and their ?step=) keep working. */
export default async function LegacyEditProductRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = new URLSearchParams(Object.entries(await searchParams).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v ? [[k, v]] : [])));
  redirect(`${productEditHref(id)}${query.size ? `?${query}` : ""}`);
}
