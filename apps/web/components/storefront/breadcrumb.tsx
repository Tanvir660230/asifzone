import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Category } from "@clothing-brand/shared";

export function Breadcrumb({ trail }: { trail: Array<{ name: string; href?: string }> }) {
  return (
    <nav className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-ink-400">
      <Link href="/" className="hover:text-ink-900">Home</Link>
      {trail.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <ChevronRight size={12} />
          {item.href ? (
            <Link href={item.href} className="hover:text-ink-900">{item.name}</Link>
          ) : (
            <span className="text-ink-700">{item.name}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function categoryBreadcrumbTrail(ancestors: Category[], current: Category) {
  return [...ancestors.map((c) => ({ name: c.name, href: `/category/${c.slug}` })), { name: current.name }];
}
