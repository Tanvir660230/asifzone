import Link from "next/link";

/** A rail's heading in the mihrab preset: title left, an optional way to see everything right, one rule underneath. */
export function MihrabSectionHead({ title, subtitle, link }: { title: string; subtitle?: string | null; link?: { href: string; label: string } }) {
  return (
    <div className="mb-8 flex items-end justify-between gap-6 border-b border-line pb-4">
      <div className="min-w-0">
        <h2 className="ui-section-heading font-display text-fg">{title}</h2>
        {subtitle && <p className="mt-2 text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {link && (
        <Link href={link.href} className="shrink-0 pb-1 text-sm font-medium text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
          {link.label}
        </Link>
      )}
    </div>
  );
}
