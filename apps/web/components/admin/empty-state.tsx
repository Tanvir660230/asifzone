import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  testId?: string;
}

/** Icon + message + optional action, for table/list empty states — same shape as the
 * storefront cart drawer's empty state, generalized for admin use. */
export function EmptyState({ icon: Icon, title, description, action, testId }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center" data-testid={testId}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-50 text-ink-300">
        <Icon size={22} />
      </div>
      <div>
        <p className="text-sm font-medium text-ink-700">{title}</p>
        {description && <p className="mt-1 max-w-xs text-sm text-ink-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}
