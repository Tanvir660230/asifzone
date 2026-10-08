"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { useNavBadges } from "@/hooks/use-nav-access";
import type { sectionBarFor } from "@/lib/admin/navigation";
import { transitions } from "@/lib/motion";
import { cn } from "@/lib/utils";

type SectionBarModel = NonNullable<ReturnType<typeof sectionBarFor>>;

/**
 * The current module's pages, pinned under the toolbar (the scope bar of a Mac app / App Store Connect's section tabs):
 * Products › All products · Categories · Variant options · Import / export · Catalog setup. One click between a module's
 * pages from anywhere in it, instead of a trip back to the sidebar's hover flyout.
 *
 * The shell renders it while the sidebar isn't listing those pages itself — always under a collapsed rail, below `lg`
 * when the sidebar is expanded (`compact`). Pages pin their own sticky bars at `top-chrome`, which accounts for it.
 * The shell resolves `bar` (sectionBarFor) so the same answer drives this and the `top-chrome` offset. Deeper tab sets (Catalog setup's ten pages) stay in the page as ModuleTabs.
 */
export function SectionBar({ bar, mode }: { bar: SectionBarModel | null; mode: "always" | "compact" }) {
  const badges = useNavBadges();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the current page's tab in view on narrow screens, where the row scrolls.
  const activeHref = bar?.activeHref;
  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeHref]);

  if (!bar) return null;

  // Arrow keys move between the tabs, as in a toolbar.
  function onKeyDown(event: KeyboardEvent<HTMLAnchorElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
    const links = Array.from(scrollRef.current?.querySelectorAll<HTMLAnchorElement>("a") ?? []);
    const index = links.indexOf(event.currentTarget);
    const next =
      event.key === "Home" ? 0 : event.key === "End" ? links.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + links.length) % links.length;
    event.preventDefault();
    links[next]?.focus();
  }

  return (
    <nav aria-label={`${bar.module.label} pages`} className={cn("border-t border-ink-900/[0.05] print:hidden", mode === "compact" && "lg:hidden")}>
      <HScrollShadow edgeFrom="from-surface">
        <div ref={scrollRef} className="flex h-section-bar items-stretch gap-1 overflow-x-auto px-2 [scrollbar-width:none] sm:px-page-compact lg:px-page [&::-webkit-scrollbar]:hidden">
          {bar.tabs.map(({ node, href }) => {
            const active = href === bar.activeHref;
            const badge = node.badge ? badges[node.badge] : 0;
            return (
              <Link
                key={node.id}
                href={href}
                aria-current={active ? "page" : undefined}
                onKeyDown={onKeyDown}
                className={cn(
                  "group relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 text-[13.5px] outline-none transition-colors duration-fast ease-smooth",
                  active ? "font-semibold text-fg" : "font-medium text-fg-muted hover:text-fg",
                )}
              >
                {/* The hover / focus wash sits inside the bar's height, the selection line on its bottom edge. */}
                <span className="pointer-events-none absolute inset-x-0 inset-y-2 rounded-lg transition-colors duration-fast ease-smooth group-hover:bg-ink-900/[0.045] group-focus-visible:ring-2 group-focus-visible:ring-accent/60" aria-hidden />
                <span className="relative">{node.label}</span>
                {badge > 0 && (
                  <span className="relative rounded-full bg-ink-900/[0.07] px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums text-ink-600" aria-label={`${badge} waiting`}>
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
                {active && (
                  <motion.span
                    layoutId={`section-bar-${bar.module.id}`}
                    transition={transitions.spring}
                    className="absolute inset-x-2.5 bottom-0 h-[2px] rounded-full bg-accent"
                    aria-hidden
                  />
                )}
              </Link>
            );
          })}
        </div>
      </HScrollShadow>
    </nav>
  );
}
