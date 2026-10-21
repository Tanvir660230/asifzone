import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface SetupStep {
  title: string;
  detail: string;
  done: boolean;
  /** Where the step is done. A step without `href` or `onSelect` is shown but not clickable (it waits for an earlier one). */
  href?: string;
  onSelect?: () => void;
  /** The word on the next step's right edge — "Start" by default. */
  cta?: string;
}

/** Steps that must happen in order before a page can work — the first one not done is highlighted and says what to do.
 * Used by the finance overview ("Finish setting up your books") and by pages that wait on another page (packaging needs
 * materials, a quick refill needs a recipe). */
export function SetupChecklist({ title, description, steps, testId }: { title: string; description?: string; steps: SetupStep[]; testId?: string }) {
  const left = steps.filter((s) => !s.done).length;
  const next = steps.findIndex((s) => !s.done);
  return (
    <Card className="p-5 sm:p-6" data-testid={testId}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[17px] font-semibold tracking-tight text-fg">{title}</h2>
        <p className="text-sm tabular-nums text-fg-muted">{steps.length - left} of {steps.length} done</p>
        {description && <p className="w-full text-sm text-fg-muted">{description}</p>}
      </div>
      <ol className="space-y-1">
        {steps.map((s, i) => {
          const current = i === next;
          const body = (
            <>
              {s.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success-600" aria-label="Done" /> : <Circle className={cn("mt-0.5 h-5 w-5 shrink-0", current ? "text-accent" : "text-ink-300")} aria-label="To do" />}
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm font-medium", s.done ? "text-fg-muted" : "text-fg")}>{i + 1}. {s.title}</span>
                <span className="block text-xs text-fg-muted">{s.detail}</span>
              </span>
              {current && (s.href || s.onSelect) && <span className="mt-0.5 shrink-0 text-sm font-medium text-accent">{s.cta ?? "Start"}</span>}
            </>
          );
          const cls = cn(
            "-mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-lg px-2 py-2.5 text-left",
            (s.href || s.onSelect) && "transition-colors duration-fast ease-smooth hover:bg-ink-900/[0.04]",
            current && "bg-accent/[0.06] hover:bg-accent/[0.09]",
          );
          return (
            <li key={s.title}>
              {s.href ? <Link href={s.href} className={cls}>{body}</Link>
                : s.onSelect ? <button type="button" onClick={s.onSelect} className={cls}>{body}</button>
                : <div className={cls}>{body}</div>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
