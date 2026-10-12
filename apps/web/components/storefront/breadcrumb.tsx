import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Category } from "@clothing-brand/shared";
import { getSiteUrl } from "@/lib/seo";
import { buildBreadcrumbJsonLd } from "@/lib/structured-data";
import { jsonLdString } from "@clothing-brand/shared";

export function Breadcrumb({ trail }: { trail: Array<{ name: string; href?: string }> }) {
  const jsonLd = buildBreadcrumbJsonLd(trail, getSiteUrl());

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />
      {/* One line at every width: the ancestors keep their size and the current page (the long product name) truncates,
          instead of the trail wrapping into ragged lines on a phone. */}
      <nav aria-label="Breadcrumb" className="flex h-4 min-w-0 items-center text-xs ui-caps text-ink-400">
        <ol className="flex min-w-0 items-center gap-1.5">
          <li className="shrink-0">
            <Link href="/" className="hover:text-ink-900">Home</Link>
          </li>
          {trail.map((item, i) => (
            <li key={i} className={item.href ? "flex shrink-0 items-center gap-1.5" : "flex min-w-0 items-center gap-1.5"}>
              <ChevronRight size={12} className="shrink-0" aria-hidden="true" />
              {item.href ? (
                <Link href={item.href} className="hover:text-ink-900">{item.name}</Link>
              ) : (
                <span aria-current="page" className="truncate text-ink-700">{item.name}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}

export function categoryBreadcrumbTrail(ancestors: Category[], current: Category) {
  return [...ancestors.map((c) => ({ name: c.name, href: `/category/${c.slug}` })), { name: current.name }];
}
