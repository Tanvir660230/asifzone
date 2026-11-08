import { Spinner } from "@/components/ui/spinner";

/** The honey preset's loading state: the store's spinner in the action colour, then the word. */
export function HoneyLoader({ label, compact }: { label: string; compact: boolean }) {
  return (
    <div className={compact ? "flex flex-col items-center gap-3 py-10" : "flex min-h-[50vh] flex-col items-center justify-center gap-3 py-24"} role="status" aria-live="polite">
      <Spinner size={compact ? 20 : 24} className="text-accent" />
      <p className="text-sm text-fg-muted">{label}</p>
    </div>
  );
}
