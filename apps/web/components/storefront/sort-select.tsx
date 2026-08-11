"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Select } from "@/components/ui/select";

const BASE_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
];

const RELEVANCE_OPTION = { value: "relevance", label: "Relevance" };

/** `hasQuery`: only the search page (with an actual `q`) has anything for "Relevance" to be
 * relevant to — a plain category browse doesn't get the option, and keeps defaulting to Newest
 * exactly as before. */
export function SortSelect({ hasQuery = false }: { hasQuery?: boolean } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("sort") ?? (hasQuery ? "relevance" : "newest");
  const options = hasQuery ? [RELEVANCE_OPTION, ...BASE_OPTIONS] : BASE_OPTIONS;

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", value);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Select value={current} onChange={(e) => handleChange(e.target.value)} className="w-48">
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </Select>
  );
}
