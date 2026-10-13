"use client";

import { type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, Search } from "lucide-react";
import { useSearchOverlayStore } from "@/store/search-overlay";
import { markNavigation } from "@/lib/nav-direction";
import { cn } from "@/lib/utils";

/** The tab bar's own pages: each is the top of its tab, with the store's header and nothing to go back to. */
const TAB_ROOTS = new Set(["/", "/wishlist", "/cart", "/account"]);

/** Where Back goes when the shopper arrived on this page from outside the store (an ad, a shared link). */
function parentOf(pathname: string): { href: string; label: string } {
  const account = /^\/account\/([^/]+)\/.+/.exec(pathname);
  if (account) return { href: `/account/${account[1]}`, label: "Back" };
  if (pathname.startsWith("/account/")) return { href: "/account", label: "Account" };
  return { href: "/", label: "Home" };
}

// Set once the shopper has moved between pages in this tab: from then on Back is the browser's back, with its scroll
// position, rather than a jump to a parent page. Module state, so it outlives the header re-rendering.
let firstPath: string | null = null;
let navigatedInApp = false;

/**
 * Phones only (below 1024px): on an inner page the store's header becomes an iOS navigation bar — Back on the left, the
 * page's name in the middle, search on the right. The name stays out of the bar while the page's own title (its h1) is
 * on screen and slides in once that title scrolls under the bar, as in Settings or Mail. On the tab bar's own pages it
 * shows `children`, the theme's phone header (logo, search). `children` stay mounted either way: the menu panel the Shop
 * tab opens lives in them.
 */
export function PhoneNavBar({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const openSearch = useSearchOverlayStore((s) => s.open);
  const [title, setTitle] = useState("");
  const [titleVisible, setTitleVisible] = useState(false);
  const isRoot = TAB_ROOTS.has(pathname) || pathname.startsWith("/checkout");

  useEffect(() => {
    if (firstPath === null) firstPath = pathname;
    else if (pathname !== firstPath) navigatedInApp = true;
  }, [pathname]);

  useEffect(() => {
    setTitleVisible(false);
    if (isRoot) return;
    const main = document.getElementById("main-content");
    if (!main) return;
    let heading: HTMLElement | null = null;
    let frame = 0;
    // The title moves into the bar once more than half of it has slid under the sticky header (a two-line product name
    // whose last line still peeks out counts as gone). Read on scroll, at most once a frame.
    const measure = () => {
      frame = 0;
      if (!heading?.isConnected) return setTitleVisible(false);
      const bar = document.querySelector("[data-nav-bar]")?.closest("header")?.getBoundingClientRect().bottom ?? 64;
      const rect = heading.getBoundingClientRect();
      setTitleVisible(rect.height > 0 && rect.bottom < bar + rect.height / 2);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    // Pages render their h1 once their data arrives and may swap it — follow whichever h1 is on the page now.
    const sync = () => {
      heading = main.querySelector("h1");
      setTitle(heading?.textContent?.trim() ?? "");
      schedule();
    };
    sync();
    const mutations = new MutationObserver(sync);
    mutations.observe(main, { childList: true, subtree: true, characterData: true });
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      mutations.disconnect();
      window.removeEventListener("scroll", schedule);
      cancelAnimationFrame(frame);
    };
  }, [pathname, isRoot]);

  // Worked out during render (the effect above records it only afterwards). False on the first render either way, so
  // the server and the browser agree.
  const inApp = navigatedInApp || (firstPath !== null && pathname !== firstPath);
  const parent = parentOf(pathname);
  const backClass =
    "-ml-1 flex h-11 min-w-0 max-w-[34vw] shrink-0 basis-[5.5rem] items-center rounded-full pr-2 text-[1.0625rem] tracking-[-0.01em] text-fg";

  return (
    <>
      <div className={isRoot ? "contents" : "hidden"}>{children}</div>
      {!isRoot && (
        <div data-nav-bar data-app-chrome className="flex h-16 items-center gap-1 px-2 lg:hidden">
          {inApp ? (
            <button
              type="button"
              onClick={() => {
                markNavigation("back");
                router.back();
              }}
              className={backClass}
            >
              <ChevronLeft size={28} strokeWidth={2} className="shrink-0" aria-hidden />
              <span className={cn("-ml-0.5 truncate", titleVisible && "sr-only")}>Back</span>
            </button>
          ) : (
            <Link href={parent.href} onClick={() => markNavigation("back")} aria-label={`Back to ${parent.label}`} className={backClass}>
              <ChevronLeft size={28} strokeWidth={2} className="shrink-0" aria-hidden />
              <span className={cn("-ml-0.5 truncate", titleVisible && "sr-only")}>{parent.label}</span>
            </Link>
          )}

          {/* The page's own h1 repeated for the eye only: drawn from data-title by CSS, so the page never carries its
              title twice for a screen reader, find-in-page or a text search. */}
          <span
            aria-hidden
            data-title={title}
            className={cn(
              "pointer-events-none min-w-0 flex-1 truncate text-center text-[1.0625rem] font-semibold tracking-[-0.015em] text-fg transition-[opacity,transform] duration-base ease-smooth before:content-[attr(data-title)]",
              titleVisible ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0",
            )}
          />

          {/* Mirrors the back button's width, so the title stays centred on the screen. */}
          <div className="flex max-w-[34vw] shrink-0 basis-[5.5rem] items-center justify-end">
            <button
              type="button"
              onClick={openSearch}
              aria-label="Search"
              className="flex h-11 w-11 items-center justify-center rounded-full text-fg"
            >
              <Search size={21} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
