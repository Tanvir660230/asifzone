import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TimelineTone = "neutral" | "info" | "success" | "warning" | "danger";

/** Plain dots (no icon) need a solid colour to be seen. */
const DOT: Record<TimelineTone, string> = {
  neutral: "bg-ink-300",
  info: "bg-info-500",
  success: "bg-success-500",
  warning: "bg-warning-500",
  danger: "bg-danger-500",
};

const TONE: Record<TimelineTone, string> = {
  neutral: "bg-ink-100 text-ink-600",
  info: "bg-info-50 text-info-700",
  success: "bg-success-50 text-success-700",
  warning: "bg-warning-50 text-warning-700",
  danger: "bg-danger-50 text-danger-600",
};

/** A vertical history (Blueprint V2 P0): order activity, a customer's history. Items render newest-first or oldest-first
 * as given; the connecting line stops at the last item. */
export function Timeline({ children, className, "aria-label": ariaLabel }: { children: ReactNode; className?: string; "aria-label"?: string }) {
  return (
    <ol className={cn("space-y-0", className)} aria-label={ariaLabel}>
      {children}
    </ol>
  );
}

interface TimelineItemProps {
  /** A small glyph inside the dot (13px icon); omitted → a plain dot. */
  icon?: ReactNode;
  tone?: TimelineTone;
  title: ReactNode;
  /** ISO time, shown formatted by the caller in `timeLabel`. */
  time?: string;
  timeLabel?: ReactNode;
  /** One quiet line under the title (who did it, a channel…). */
  meta?: ReactNode;
  /** Free text attached to the event, kept apart from the title. */
  note?: ReactNode;
  /** The last item draws no connecting line. */
  last?: boolean;
  className?: string;
  "data-concept"?: string;
}

export function TimelineItem({ icon, tone = "neutral", title, time, timeLabel, meta, note, last, className, ...rest }: TimelineItemProps) {
  return (
    <li className={cn("flex gap-3", className)} {...rest}>
      <div className="flex flex-col items-center">
        {icon ? (
          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", TONE[tone])} aria-hidden="true">
            {icon}
          </span>
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center" aria-hidden="true">
            <span className={cn("h-2.5 w-2.5 rounded-full", DOT[tone])} />
          </span>
        )}
        {!last && <span className="my-1 w-px flex-1 bg-line-subtle" aria-hidden="true" />}
      </div>
      <div className="min-w-0 flex-1 pb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <div className="text-sm font-medium text-fg">{title}</div>
          {timeLabel && (
            <time dateTime={time} className="text-xs tabular-nums text-fg-subtle">
              {timeLabel}
            </time>
          )}
        </div>
        {meta && <div className="mt-0.5 flex items-center gap-1 text-xs text-fg-muted">{meta}</div>}
        {note && <div className="mt-1.5 whitespace-pre-line break-words rounded-lg bg-surface-muted px-2.5 py-1.5 text-sm text-ink-700">{note}</div>}
      </div>
    </li>
  );
}
