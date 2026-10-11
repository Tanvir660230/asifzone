import type { ReactNode } from "react";
import { AlertTriangle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** `plain` sits inside an existing container (table body, card); `bordered` stands alone on a page. */
  variant?: "plain" | "bordered";
  tone?: "neutral" | "danger";
  className?: string;
  testId?: string;
}

/** The one empty/zero state: icon, message, optional next action. Used by admin lists, account
 * pages and storefront panels alike. */
export function EmptyState({ icon: Icon, title, description, action, variant = "plain", tone = "neutral", className, testId }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-4 text-center",
        variant === "bordered" ? "rounded-xl border border-dashed border-line py-14" : "py-16",
        className,
      )}
      data-testid={testId}
    >
      <div
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full ring-1 ring-inset",
          tone === "danger" ? "bg-danger-50 text-danger-500 ring-danger-100" : "bg-surface-muted text-fg-subtle ring-line-subtle",
        )}
      >
        <Icon size={22} aria-hidden="true" />
      </div>
      <div>
        <p className="font-display text-base tracking-tight text-fg">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  variant?: EmptyStateProps["variant"];
  className?: string;
}

/** A failed load: says what happened and offers a retry when one makes sense. */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this. Check your connection and try again.",
  onRetry,
  variant,
  className,
}: ErrorStateProps) {
  return (
    <div role="alert">
      <EmptyState
        icon={AlertTriangle}
        tone="danger"
        title={title}
        description={description}
        variant={variant}
        className={className}
        action={
          onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          )
        }
      />
    </div>
  );
}
