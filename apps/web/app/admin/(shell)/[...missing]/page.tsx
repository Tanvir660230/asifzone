import { notFound } from "next/navigation";

/** Any address under /admin that is not a page: the admin's own "not found" (not-found.tsx beside this), inside the
 * console with its sidebar, instead of the storefront 404. */
export default function Page() {
  notFound();
}
