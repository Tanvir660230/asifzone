import { StorefrontShell } from "@/components/storefront/storefront-shell";
import { NotFoundContent } from "@/components/storefront/not-found-content";

/** Root-level fallback for a URL that matches no route at all (a typo, a dead external link) — (storefront)/not-found.tsx
 * only covers notFound() thrown inside that route group. Rendered in the full storefront shell, so even a dead link lands
 * on the site itself (header, search, bag), not a bare page. */
export default function RootNotFound() {
  return (
    <StorefrontShell>
      <NotFoundContent />
    </StorefrontShell>
  );
}
