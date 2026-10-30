import { cn } from "@/lib/utils";

/** The tahafi preset's loading state: the logo's two diamonds taking turns, then the word. No data, no waiting. */
export function TahafiLoader({ label, compact }: { label: string; compact: boolean }) {
  return (
    <div
      className={cn("ui-delayed flex flex-col items-center justify-center gap-4", compact ? "py-10" : "min-h-[50vh] py-24")}
      role="status"
      aria-live="polite"
    >
      <svg aria-hidden="true" viewBox="0 0 156 78" className={cn("ui-diamond-turn fill-current text-accent", compact ? "w-8" : "w-11")}>
        <path d="M39 0l39 39-39 39L0 39z" />
        <path d="M117 0l39 39-39 39-39-39z" />
      </svg>
      <p className="text-sm text-fg-muted">{label}</p>
    </div>
  );
}
