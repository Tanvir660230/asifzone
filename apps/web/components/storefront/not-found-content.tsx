import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { StorefrontPage, StorefrontPageHeader } from "./storefront-page";

/** "Page not found", in the same frame and heading as every page, with the two ways on: home and the full catalog. Shared
 * by the storefront route groups' not-found pages and the site-wide one. */
export function NotFoundContent() {
  return (
    <StorefrontPage>
      <StorefrontPageHeader
        eyebrow="404"
        title="Page not found"
        description="The page you're looking for doesn't exist or has moved. These will get you back on track."
      />
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link href="/" className={buttonVariants({ variant: "primary", size: "lg" })}>
          Back to home
        </Link>
        <Link href="/search" className={buttonVariants({ variant: "outline", size: "lg" })}>
          Browse all products
        </Link>
      </div>
    </StorefrontPage>
  );
}
