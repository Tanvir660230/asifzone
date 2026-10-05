import { redirect } from "next/navigation";

/** The Product Builder moved to /admin/products/new; old links (and their ?step=) keep working. */
export default async function LegacyNewProductRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams(Object.entries(await searchParams).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v ? [[k, v]] : [])));
  redirect(`/admin/products/new${query.size ? `?${query}` : ""}`);
}
