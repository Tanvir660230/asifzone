import Link from "next/link";
import { SearchX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

interface NoSearchResultsProps {
  query: string;
  /** Best-guess spelling correction from the catalog's search vocabulary — populated only when
   * the backend genuinely found a close-enough match (see product.service.ts's findDidYouMean). */
  didYouMean?: string;
}

/** Search-specific counterpart to ComingSoon (which fits an empty category, not a zero-result
 * query) — same panel treatment as the rest of the storefront's empty states, so a dead-end
 * search doesn't read as more broken than an empty cart or an unfinished category. */
export function NoSearchResults({ query, didYouMean }: NoSearchResultsProps) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-ink-200 bg-cream-50 px-6 py-20 text-center sm:py-28">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-ink-100 text-ink-400">
        <SearchX size={26} />
      </span>
      <h2 className="mt-6 font-display text-2xl text-ink-900 sm:text-3xl">No results found</h2>
      <p className="mx-auto mt-3 max-w-sm text-sm text-ink-500">
        We couldn&rsquo;t find anything for &ldquo;{query}&rdquo;. Try a different search term, or browse our categories instead.
      </p>
      {didYouMean && (
        <Link
          href={`/search?q=${encodeURIComponent(didYouMean)}`}
          className="mt-4 text-sm text-ink-700 underline underline-offset-2 transition-colors duration-150 ease-smooth hover:text-brass-600"
        >
          Did you mean <span className="font-medium">&ldquo;{didYouMean}&rdquo;</span>?
        </Link>
      )}
      <Link href="/" className={buttonVariants({ variant: "primary", size: "lg", className: "mt-8" })}>
        Continue shopping
      </Link>
    </div>
  );
}
