import { ARCH_PATH } from "./arch";

/** The mihrab preset's loading state: the arch outline tracing itself, then the word. No data, no waiting. */
export function MihrabLoader({ label, compact }: { label: string; compact: boolean }) {
  return (
    <div className={compact ? "flex flex-col items-center gap-3 py-10" : "flex min-h-[50vh] flex-col items-center justify-center gap-4 py-24"} role="status" aria-live="polite">
      <svg aria-hidden viewBox="-2 -2 104 129" className={compact ? "ui-arch-trace h-9 w-7 text-fg" : "ui-arch-trace h-14 w-11 text-fg"}>
        <path d={ARCH_PATH} pathLength={1} fill="none" stroke="currentColor" strokeWidth="4" />
      </svg>
      <p className="text-sm text-fg-muted">{label}</p>
    </div>
  );
}
