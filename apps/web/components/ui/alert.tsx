import { type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Inline, persistent message tied to a place on the page (form-level error, warning about a
 * setting, success after a long operation). For transient feedback use `toast`. */
export const alertVariants = cva("flex gap-3 rounded-xl border px-4 py-3 text-sm", {
  variants: {
    variant: {
      info: "border-info-200 bg-info-50 text-info-700",
      success: "border-success-200 bg-success-50 text-success-700",
      warning: "border-warning-200 bg-warning-50 text-warning-700",
      danger: "border-danger-200 bg-danger-50 text-danger-700",
      neutral: "border-line bg-surface-muted text-ink-700",
    },
  },
  defaultVariants: { variant: "info" },
});

const ICONS: Record<NonNullable<VariantProps<typeof alertVariants>["variant"]>, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  neutral: Info,
};

interface AlertProps extends VariantProps<typeof alertVariants> {
  title?: ReactNode;
  children?: ReactNode;
  /** Trailing action (e.g. a "Retry" button). */
  action?: ReactNode;
  /** Set false to hide the leading icon. */
  icon?: boolean;
  className?: string;
}

export function Alert({ variant, title, children, action, icon = true, className }: AlertProps) {
  const Icon = ICONS[variant ?? "info"];
  return (
    <div role={variant === "danger" || variant === "warning" ? "alert" : "status"} className={cn(alertVariants({ variant }), className)}>
      {icon && <Icon size={18} className="mt-px shrink-0" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "text-ink-700")}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}
