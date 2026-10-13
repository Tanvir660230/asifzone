import Link from "next/link";
import { SearchX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

interface NoSearchResultsProps {
  query: string;
  /** Best-guess spelling correction from the catalog's search vocabulary — populated only when
   * the backend genuinely found a close-enough match (see product.service.ts's findDidYouMean). */
  didYouMean?: string;
  /** What other shoppers search for, as one-tap ways out of the dead end. */
  popular?: string[];
}

const searchHref = (q: string) => `/search?q=${encodeURIComponent(q)}`;

/** A zero-result search: say so plainly, offer the spelling fix when there is one, then a few searches that do work. */
export function NoSearchResults({ query, didYouMean, popular = [] }: NoSearchResultsProps) {
  const others = popular.filter((q) => q.toLowerCase() !== query.toLowerCase()).slice(0, 6);
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center sm:py-24">
      <SearchX size={36} strokeWidth={1.5} className="text-ink-300" aria-hidden />
      <h2 className="mt-5 text-balance font-display text-2xl text-fg sm:text-3xl">No results for &ldquo;{query}&rdquo;</h2>
      {didYouMean ? (
        <p className="mt-3 text-[15px] text-fg-muted">
          Did you mean{" "}
          <Link href={searchHref(didYouMean)} className="font-medium text-fg underline underline-offset-4 transition-opacity hover:opacity-70">
            {didYouMean}
          </Link>
          ?
        </p>
      ) : (
        <p className="mx-auto mt-3 max-w-sm text-[15px] text-fg-muted">Check the spelling, or try a shorter or more general word.</p>
      )}
      {others.length > 0 && (
        <div className="mt-8">
          <p className="text-[13px] font-semibold text-fg">Popular searches</p>
          <ul className="mt-3 flex max-w-md flex-wrap justify-center gap-2">
            {others.map((q) => (
              <li key={q}>
                <Link
                  href={searchHref(q)}
                  className="inline-flex h-9 items-center rounded-[var(--chip-radius)] bg-ink-100/70 px-4 text-sm text-fg transition-colors duration-fast ease-smooth hover:bg-ink-100"
                >
                  {q}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Link href="/search" className={buttonVariants({ variant: "outline", size: "md", className: "mt-10" })}>
        Browse all products
      </Link>
    </div>
  );
}
