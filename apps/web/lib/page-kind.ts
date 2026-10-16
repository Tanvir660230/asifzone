import type { PageKind } from "@clothing-brand/shared";

/** Site speed groups real-visitor measurements by kind of page, never by URL — a kind has enough visits to mean something
 * and carries nothing about which product or customer it was. null = not measured (admin, product preview). */
export function pageKindFromPath(pathname: string): PageKind | null {
  const [first = "", second] = pathname.split("/").filter(Boolean);
  switch (first) {
    case "":
      return "home";
    case "admin":
    case "preview":
      return null;
    case "product":
      return second ? "product" : "other";
    case "category":
      return second ? "category" : "other";
    case "search":
      return "search";
    case "cart":
      return "cart";
    case "checkout":
    case "pay":
      return "checkout";
    case "lp":
      return second ? "landing" : "other";
    case "account":
      return "account";
    default:
      return "other";
  }
}
