import type { ReactNode } from "react";
import { BackLink } from "@/components/ui/back-link";
import { cn } from "@/lib/utils";

interface RecordPageProps {
  /** Where the record's list lives ("Purchase orders"). */
  back: { href: string; label: string };
  /** The record's name or number. */
  title: ReactNode;
  /** One line of facts under the title (who, when, terms). */
  subtitle?: ReactNode;
  /** The record's status, beside the title — a Badge. */
  status?: ReactNode;
  /** The legal next steps for this status, primary first; they sit at the header's right and wrap on phones. */
  actions?: ReactNode;
  /** Side column (links, totals, timeline). With it the body is 2/3 + 1/3 from laptop width. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * The record page anatomy of DESIGN_SYSTEM §6: a back link to the list, then one header row — title with its status,
 * a line of facts, the next actions on the right — then the record's sections (optionally beside an aside). Every
 * record (a purchase order, a production run, a supplier's account) reads the same way.
 */
export function RecordPage({ back, title, subtitle, status, actions, aside, children, className }: RecordPageProps) {
  return (
    <div data-pattern="record-page" className={cn("space-y-6", className)}>
      <div className="space-y-3">
        <BackLink href={back.href} label={back.label} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="min-w-0 font-display text-display-sm text-fg">{title}</h1>
              {status}
            </div>
            {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
        </div>
      </div>
      {aside ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="min-w-0 space-y-6 lg:col-span-2">{children}</div>
          <aside className="min-w-0 space-y-4">{aside}</aside>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

/** One titled part of a record (its lines, its receipts, its statement). */
export function RecordSection({ title, description, action, children, className, ...rest }: { title: string; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string } & Record<`data-${string}`, string>) {
  return (
    <section className={cn("space-y-2", className)} {...rest}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
