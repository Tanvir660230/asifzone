"use client";

import { type ReactNode, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, Search } from "lucide-react";
import { useSearchOverlayStore } from "@/store/search-overlay";
import { markNavigation } from "@/lib/nav-direction";

/** The tab bar's own pages: each is the top of its tab, with the store's header and nothing to go back to. */
const TAB_ROOTS = new Set(["/", "/wishlist", "/cart", "/account"]);

/** Where Back goes when the shopper arrived on this page from outside the store (an ad, a shared link). */
function parentOf(pathname: string): { href: string; label: string } {
  if (pathname.startsWith("/checkout")) return { href: "/cart", label: "your bag" };
  const account = /^\/account\/([^/]+)\/.+/.exec(pathname);
  if (account) return { href: `/account/${account[1]}`, label: "the previous page" };
  if (pathname.startsWith("/account/")) return { href: "/account", label: "your account" };
  return { href: "/", label: "the home page" };
}

// Set once the shopper has moved between pages in this tab: from then on Back is the browser's back, with its scroll
// position, rather than a jump to a parent page. Module state, so it outlives the header re-rendering.
let firstPath: string | null = null;
let navigatedInApp = false;

const sideClass = "flex w-14 shrink-0 items-center";
const iconButtonClass = "flex h-11 w-11 items-center justify-center rounded-full text-fg";

/**
 * Phones only (below 1024px). On the tab bar's own pages it shows `children`, the theme's phone header. On every page
 * inside them the header keeps the same shape — the store's logo in the middle, search on the right — and only the left
 * button changes, to Back. The shopper always sees whose shop this is, and the one thing that moves is the way out.
 * `children` stay mounted either way: the menu panel the Shop tab opens lives in them.
 */
export function PhoneNavBar({ brand, children }: { brand: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const openSearch = useSearchOverlayStore((s) => s.open);
  // The checkout counts as inside the bag: Back returns to it, and the menu is out of the way while paying.
  const isRoot = TAB_ROOTS.has(pathname);

  useEffect(() => {
    if (firstPath === null) firstPath = pathname;
    else if (pathname !== firstPath) navigatedInApp = true;
  }, [pathname]);

  // Worked out during render (the effect above records it only afterwards). False on the first render either way, so
  // the server and the browser agree.
  const inApp = navigatedInApp || (firstPath !== null && pathname !== firstPath);
  const parent = parentOf(pathname);
  const back = <ChevronLeft size={28} strokeWidth={2} aria-hidden />;

  return (
    <>
      <div className={isRoot ? "contents" : "hidden"}>{children}</div>
      {!isRoot && (
        <div data-nav-bar data-app-chrome className="flex h-16 items-center justify-between gap-2 px-2 lg:hidden">
          <div className={sideClass}>
            {inApp ? (
              <button
                type="button"
                aria-label="Back"
                onClick={() => {
                  markNavigation("back");
                  router.back();
                }}
                className={iconButtonClass}
              >
                {back}
              </button>
            ) : (
              <Link href={parent.href} onClick={() => markNavigation("back")} aria-label={`Back to ${parent.label}`} className={iconButtonClass}>
                {back}
              </Link>
            )}
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-center">{brand}</div>
          <div className={`${sideClass} justify-end`}>
            <button type="button" onClick={openSearch} aria-label="Search" className={iconButtonClass}>
              <Search size={21} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
