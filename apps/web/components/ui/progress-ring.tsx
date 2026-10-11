import { cn } from "@/lib/utils";

interface ProgressRingProps {
  /** 0–100. */
  value: number;
  size?: number;
  strokeWidth?: number;
  /** Accessible name, e.g. "Product completeness". */
  label: string;
  /** Color by thresholds (≥90 success, ≥60 warning, else danger) instead of the accent color. */
  tone?: "accent" | "threshold";
  className?: string;
  /** Shown in the middle; defaults to the percentage. */
  children?: React.ReactNode;
}

/** Circular progress indicator (completion scores, quotas). */
export function ProgressRing({ value, size = 44, strokeWidth = 4, label, tone = "accent", className, children }: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const color =
    tone === "accent" ? "text-accent" : clamped >= 90 ? "text-success-500" : clamped >= 60 ? "text-warning-500" : "text-danger-500";

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} className="stroke-ink-100" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className={cn("transition-[stroke-dashoffset] duration-slow ease-smooth", color)}
        />
      </svg>
      <span className="absolute text-[0.6875rem] font-semibold tabular-nums text-fg">{children ?? `${clamped}%`}</span>
    </div>
  );
}
