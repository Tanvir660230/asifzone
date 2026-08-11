import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { getSiteSettingsSafe } from "@/lib/api/storefront";

/** Root-level fallback for a URL that doesn't match any route at all (typo'd path, dead external
 * link) — (storefront)/not-found.tsx only covers notFound() thrown from inside that route group's
 * pages, so anything outside it still needs a branded landing here instead of Next's default
 * unstyled 404. Renders inside the existing root layout (which already supplies <html>/<body>),
 * so no header/footer nav here — just enough brand presence, logo/name and a way back. */
export default async function RootNotFound() {
  const { settings } = await getSiteSettingsSafe();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-cream-100 px-4 py-24 text-center">
      <span className="font-display text-xl font-semibold tracking-tight text-ink-900">{settings.storeName}</span>
      <span className="mt-8 flex h-16 w-16 items-center justify-center rounded-full bg-ink-100 text-ink-400">
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
