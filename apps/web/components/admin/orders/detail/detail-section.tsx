import { useId, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** The card every order-detail section uses: one heading row (icon, title, optional actions), then content. Solid
 * surface — content stays opaque; glass is reserved for chrome. */
export function DetailSection({
  title,
  icon: Icon,
  actions,
  children,
  className,
  testId,
}: {
  title: string;
  icon: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-testid={testId} className={cn("rounded-xl border border-line-subtle bg-surface shadow-sm", className)}>
      <div className="flex min-h-[52px] items-center gap-2 border-b border-line-subtle px-4 py-2.5 sm:px-5">
        <Icon size={15} className="shrink-0 text-ink-400" aria-hidden="true" />
        <h3 id={headingId} className="flex-1 text-sm font-semibold tracking-tight text-ink-900">
          {title}
        </h3>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

/** Label/value pair for the compact fact grids inside sections. */
export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-800">{children}</dd>
    </div>
  );
}

/** Why an action isn't offered right now — shown instead of silently hiding it. */
export function BlockedHint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-ink-400">{children}</p>;
}
