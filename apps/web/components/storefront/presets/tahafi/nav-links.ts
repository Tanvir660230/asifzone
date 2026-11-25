import { navHref, type NavNode } from "@/lib/nav-links";

export interface DesktopNavLink {
  label: string;
  href: string;
}

/**
 * The wide-screen header's links. A store with one top-level category (Tahafi's Jackets) would show a single word alone
 * in the middle of the bar; then its sub-categories are the links, followed by the whole category ("All Jackets").
 * Several top-level entries stay as they are. At most `max` links.
 */
export function desktopNavLinks(menu: NavNode[], max = 6): DesktopNavLink[] {
  const only = menu.length === 1 ? menu[0] : null;
  if (only && only.children.length > 0) {
    return [
      ...only.children.slice(0, max - 1).map((child) => ({ label: child.name, href: navHref(child) })),
      { label: `All ${only.name}`, href: navHref(only) },
    ];
  }
  return menu.slice(0, max).map((node) => ({ label: node.name, href: navHref(node) }));
}
