import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface AccountEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

/** Shared empty-state block for /account list pages (orders, returns, addresses, coupons,
 * reward points, browsing history) — replaces one-line "No X yet" text with a centered icon,
 * message, and optional CTA. */
export function AccountEmptyState({ icon: Icon, title, description, action }: AccountEmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-ink-200 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-50">
        <Icon size={20} className="text-ink-400" />
      </div>
      <div>
        <p className="font-display text-base text-ink-900">{title}</p>
        {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}
