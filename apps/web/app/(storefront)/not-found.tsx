import { NotFoundContent } from "@/components/storefront/not-found-content";

/** Catches both a mistyped URL and `notFound()` thrown from a dynamic route (deleted/renamed product or category slug),
 * rendered inside this group's storefront shell. */
export default function StorefrontNotFound() {
  return <NotFoundContent />;
}
