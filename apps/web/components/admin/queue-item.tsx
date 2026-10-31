import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type QueueSeverity = "critical" | "warning" | "info";

export interface QueueItemData {
  key: string;
  label: string;
  /** One line on what doing it means — the item should read as a task, not a metric. */
  hint: string;
  count: number;
  href: string;
  severity: QueueSeverity;
  icon: LucideIcon;
}

export const QUEUE_SEVERITY_ORDER: Record<QueueSeverity, number> = { critical: 0, warning: 1, info: 2 };

const SEVERITY_STYLE: Record<QueueSeverity, { chip: string; count: string; bar: string }> = {
  critical: { chip: "bg-danger-50 text-danger-600", count: "bg-danger-600 text-white", bar: "bg-danger-500" },
  warning: { chip: "bg-warning-50 text-warning-600", count: "bg-warning-100 text-warning-700", bar: "bg-warning-500" },
  info: { chip: "bg-info-50 text-info-600", count: "bg-ink-100 text-ink-700", bar: "bg-info-500" },
};

/**
 * One queue item (blueprint P2.1, docs/DESIGN_SYSTEM.md §6): severity bar, icon, the task in a few words, why in one line,
 * how many, and the whole row links to where it is done. It only goes away when the work is done — no dismiss. A list item
 * for a `<ul>` laid out by the caller (Home's work queue).
 */
export function QueueItem({ item }: { item: QueueItemData }) {
  const style = SEVERITY_STYLE[item.severity];
  const Icon = item.icon;
  return (
    // An odd last item spans both columns so the grid never ends on an empty tinted cell.
    <li className="bg-surface md:[&:last-child:nth-child(odd)]:col-span-2" data-testid={`action-${item.key}`}>
      <Link
        href={item.href}
        className="group relative flex h-full items-center gap-3.5 px-5 py-3.5 transition-colors duration-150 ease-smooth hover:bg-ink-50/70 focus-visible:bg-ink-50 focus-visible:outline-none sm:px-6"
      >
        <span aria-hidden className={cn("absolute inset-y-3 left-0 w-[3px] rounded-r-full", style.bar)} />
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", style.chip)}>
          <Icon size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink-900">{item.label}</span>
          <span className="block truncate text-xs text-ink-500">{item.hint}</span>
        </span>
        <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums", style.count)}>{item.count}</span>
        <ChevronRight size={16} aria-hidden className="shrink-0 text-ink-300 transition-transform duration-150 ease-smooth group-hover:translate-x-0.5 group-hover:text-ink-500" />
      </Link>
    </li>
  );
}
