import { cn } from "@/lib/utils";

/** The small count bubble on a bag icon (header, mobile bottom nav, sticky cart bar). Decorative: the control that
 * carries it states the count in its accessible name, so screen readers don't hear the number twice. */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  return (
    // Keyed on the count, so each change re-mounts the bubble and replays its bump: the add registered.
    <span
      key={count}
      aria-hidden="true"
      className={cn(
        "absolute flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold leading-none tabular-nums text-accent-fg ring-2 ring-surface animate-count-bump",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** "Bag", "Bag, 1 item", "Bag, 3 items" — the accessible name of a control that shows a CountBadge. */
export function bagLabel(base: string, count: number) {
  return count > 0 ? `${base}, ${count} item${count === 1 ? "" : "s"}` : base;
}
