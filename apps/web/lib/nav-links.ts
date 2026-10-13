import type { DesignNavLink } from "@clothing-brand/shared";
import type { CategoryTreeNode } from "@/lib/api/storefront";

/** A main-menu entry: a category (links to /category/<slug>), or one of the store's own menu links (Site design →
 * Header), which carries its own href. The menus read only these fields, so both fit without pretending to be the other. */
export interface NavNode {
  id: string;
  name: string;
  slug: string;
  href?: string;
  /** Categories only: the photo the phone menu shows beside the name. */
  imageUrl?: string | null;
  children: NavNode[];
}

export function navHref(node: Pick<NavNode, "slug" | "href">) {
  return node.href ?? `/category/${node.slug}`;
}

/** The store's menu links first (New in, Sale …), then the categories — one list for every menu (desktop, phone, presets). */
export function withMenuLinks(categories: CategoryTreeNode[], links: DesignNavLink[] | undefined): NavNode[] {
  const extra: NavNode[] = (links ?? []).map((link, i) => ({ id: `menu-link-${i}`, name: link.label, slug: "", href: link.href, children: [] }));
  return [...extra, ...categories];
}
