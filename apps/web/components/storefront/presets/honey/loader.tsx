import { Disc } from "./disc";

/** The honey preset's loading state: the disc breathing softly, then the word. No data, no waiting. */
export function HoneyLoader({ label, compact }: { label: string; compact: boolean }) {
  return (
    <div className={compact ? "flex flex-col items-center gap-3 py-10" : "flex min-h-[50vh] flex-col items-center justify-center gap-4 py-24"} role="status" aria-live="polite">
      <Disc className={compact ? "ui-disc-breathe w-8" : "ui-disc-breathe w-12"} />
      <p className="text-sm text-fg-muted">{label}</p>
    </div>
  );
}
