import type { ReactNode } from "react";

interface AccountPageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

/** Shared heading for every /account subpage — keeps title styling, spacing, and the optional
 * right-aligned action button (e.g. addresses' "Add address") consistent across the section. */
export function AccountPageHeader({ title, description, action }: AccountPageHeaderProps) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl text-ink-900 sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
