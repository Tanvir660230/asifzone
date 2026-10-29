import { Lock, type LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * A page this admin's role can't open (ERP UI plan, tab 21 §3): says so plainly and who can change it, and shows no figure,
 * count or badge from the page. The sidebar never links here — it only appears when someone follows an old link or a
 * bookmark. The API refuses the page's calls either way.
 */
export function PermissionState({ page, icon = Lock, className }: { page: string; icon?: LucideIcon; className?: string }) {
  return (
    <EmptyState
      icon={icon}
      title={`You don't have access to ${page}`}
      description="Your role doesn't include this page. Ask an owner if you need it."
      className={className}
      testId="permission-state"
    />
  );
}
