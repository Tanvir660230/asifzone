"use client";

import { type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, Search } from "lucide-react";
import { breadcrumbsFor, pageTitleFor } from "@/lib/admin/navigation";
import { cn } from "@/lib/utils";

/** The page the back button returns to: the nearest ancestor in the manifest that has a route. Null on a module's own
 * landing page, which is a tab-bar or More destination and has nowhere further up to go. */
export function useMobileBack(): { label: string; href: string } | null {
  const crumbs = breadcrumbsFor(usePathname());
  const parent = crumbs.slice(0, -1).reverse().find((c) => c.href);
  return crumbs.length >= 2 && parent?.href ? { label: parent.label, href: parent.href } : null;
}

/**
 * Phones only (below md): the toolbar as an iOS navigation bar. A back button to the parent page on the left, the page's
 * name in the middle, search and the console's actions on the right. The name stays out of the bar while the page's own
 * large title (its h1) is on screen, and slides in once that title scrolls under the bar — the way Settings and Mail do.
 */
export function MobileNavBar({ scrollRoot, onSearch, actions }: { scrollRoot: HTMLElement | null; onSearch: () => void; actions: ReactNode }) {
  const pathname = usePathname();
  const back = useMobileBack();
  const title = pageTitleFor(pathname) ?? "";
  const [largeTitleVisible, setLargeTitleVisible] = useState(true);

  useEffect(() => {
    if (!scrollRoot) return;
    let observer: IntersectionObserver | null = null;
    let observed: Element | null = null;
    let frame = 0;
    // Pages render their h1 once their data arrives, and may swap it — follow whichever h1 is on the page now.
    const sync = () => {
      frame = 0;
      const heading = scrollRoot.querySelector("main h1");
      if (heading === observed) return;
      observer?.disconnect();
      observed = heading;
      if (!heading) {
        setLargeTitleVisible(false);
        return;
      }
      // The pinned chrome (this bar, plus the section bar when it shows) covers the top of the scroll box: a title
      // tucked under it counts as scrolled away.
      const chrome = scrollRoot.firstElementChild?.getBoundingClientRect().height ?? 0;
      observer = new IntersectionObserver(([entry]) => setLargeTitleVisible(entry?.isIntersecting ?? false), {
        root: scrollRoot,
        rootMargin: `-${Math.round(chrome)}px 0px 0px 0px`,
      });
      observer.observe(heading);
    };
    sync();
    const mutations = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(sync);
    });
    mutations.observe(scrollRoot, { childList: true, subtree: true });
    return () => {
      observer?.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [scrollRoot, pathname]);

  return (
    <header className="flex h-header items-center gap-0.5 px-2 md:hidden">
      {back ? (
        <Link
          href={back.href}
          aria-label={`Back to ${back.label}`}
          className="-ml-0.5 flex h-11 min-w-0 max-w-[32vw] shrink-0 items-center rounded-full pr-1 text-[17px] tracking-[-0.02em] text-accent active:opacity-50"
        >
          <ChevronLeft size={28} strokeWidth={2.2} className="-mr-0.5 shrink-0" aria-hidden />
          <span className="truncate">{back.label}</span>
        </Link>
      ) : (
        <span className="w-1 shrink-0" />
      )}

      <p
        aria-hidden={largeTitleVisible}
        className={cn(
          "pointer-events-none min-w-0 flex-1 truncate px-1.5 text-[17px] font-semibold tracking-[-0.02em] text-fg transition-[opacity,transform] duration-base ease-smooth",
          back ? "text-center" : "text-left",
          largeTitleVisible ? "translate-y-1 opacity-0" : "translate-y-0 opacity-100",
        )}
      >
        {title}
      </p>

      <div className="flex shrink-0 items-center">
        <button
          type="button"
          onClick={onSearch}
          aria-label="Search"
          className="flex h-11 w-11 items-center justify-center rounded-full text-ink-700 active:bg-ink-900/[0.06]"
        >
          <Search size={21} strokeWidth={2} />
        </button>
        {actions}
      </div>
    </header>
  );
}
