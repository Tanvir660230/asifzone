import { describe, expect, it } from "vitest";
import type { NavNode } from "@/lib/nav-links";
import { desktopNavLinks } from "./nav-links";

const node = (name: string, slug: string, children: NavNode[] = [], href?: string): NavNode => ({ id: slug || name, name, slug, href, children });

describe("desktopNavLinks", () => {
  it("opens a lone category into its sub-categories, then the whole category", () => {
    const menu = [node("Jackets", "jackets", [node("Sleeveless Jackets", "sleeveless-jackets"), node("Full-Sleeve Jackets", "full-sleeve-jackets")])];
    expect(desktopNavLinks(menu)).toEqual([
      { label: "Sleeveless Jackets", href: "/category/sleeveless-jackets" },
      { label: "Full-Sleeve Jackets", href: "/category/full-sleeve-jackets" },
      { label: "All Jackets", href: "/category/jackets" },
    ]);
  });

  it("keeps several top-level entries as they are, up to the limit", () => {
    const menu = ["A", "B", "C", "D", "E", "F", "G"].map((n) => node(n, n.toLowerCase(), [node(`${n}1`, `${n}1`)]));
    expect(desktopNavLinks(menu).map((l) => l.label)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(desktopNavLinks(menu, 3)).toHaveLength(3);
  });

  it("uses a menu link's own href", () => {
    const menu = [node("New in", "", [], "/search?sort=new"), node("Jackets", "jackets")];
    expect(desktopNavLinks(menu)).toEqual([
      { label: "New in", href: "/search?sort=new" },
      { label: "Jackets", href: "/category/jackets" },
    ]);
  });

  it("keeps a lone category without children as one link, and an empty menu empty", () => {
    expect(desktopNavLinks([node("Jackets", "jackets")])).toEqual([{ label: "Jackets", href: "/category/jackets" }]);
    expect(desktopNavLinks([])).toEqual([]);
  });
});
