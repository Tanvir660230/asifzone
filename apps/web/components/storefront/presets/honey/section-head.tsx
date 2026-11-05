import Link from "next/link";

/** A rail's heading in the honey preset: the title on the left, a way to see everything on the right. */
export function HoneySectionHead({ title, subtitle, link }: { title: string; subtitle?: string | null; link?: { href: string; label: string } }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-6 sm:mb-6">
      <div className="min-w-0">
        <h2 className="ui-section-heading font-display text-fg">{title}</h2>
        {subtitle && <p className="mt-2 text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {link && (
        <Link href={link.href} className="shrink-0 font-display text-base font-medium tracking-normal text-[color:var(--nav-hover)]">
          {link.label}
        </Link>
      )}
    </div>
  );
}
