import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/** Catches both a mistyped URL and `notFound()` thrown from a dynamic route (deleted/renamed
 * product or category slug) — without this, either case fell through to Next's unstyled default
 * 404, the only unbranded page a customer could land on. */
export default function StorefrontNotFound() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col items-center px-4 py-24 text-center sm:px-6 sm:py-32 lg:px-8">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-ink-100 text-ink-400">
        <Compass size={26} />
      </span>
      <h1 className="mt-6 font-display text-3xl text-ink-900 sm:text-4xl">Page not found</h1>
      <p className="mx-auto mt-3 max-w-sm text-sm text-ink-500">
        The page you&rsquo;re looking for doesn&rsquo;t exist or may have moved. Let&rsquo;s get you back on track.
      </p>
      <Link href="/" className={buttonVariants({ variant: "primary", size: "lg", className: "mt-8" })}>
        Back to home
      </Link>
    </div>
  );
}
