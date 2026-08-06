import Link from "next/link";
import { Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

interface ComingSoonProps {
  categoryName: string;
}

/** Shown on a category page that's live (isActive) but doesn't have any products in it yet —
 * distinct from a 404 (the category is real and intentionally visible) and from ProductGrid's
 * plain "No products found." (which fits a zero-result search, not a whole category). */
export function ComingSoon({ categoryName }: ComingSoonProps) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-ink-200 bg-cream-50 px-6 py-20 text-center sm:py-28">
      <span className="glossy mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-brass-100 text-brass-500">
        <Sparkles size={26} />
      </span>
      <h2 className="font-display text-2xl text-ink-900 sm:text-3xl">Coming Soon</h2>
      <p className="mx-auto mt-3 max-w-sm text-sm text-ink-500">
        We&apos;re putting the finishing touches on {categoryName}. New arrivals will land here soon — check back shortly.
      </p>
      <Link href="/" className={buttonVariants({ variant: "brass", size: "lg", className: "mt-8" })}>
        Continue shopping
      </Link>
    </div>
  );
}
