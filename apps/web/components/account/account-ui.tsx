import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, Package } from "lucide-react";
import { resolveImageUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";

/** Building blocks shared by the account pages (docs/ACCOUNT_HOME.md): Apple-style grouped lists on solid surfaces,
 * product thumbnails, and section headings. Account pages compose these instead of styling their own cards. */

export function OrderThumb({ imageUrl, alt, className, sizes = "56px" }: { imageUrl: string | null; alt: string; className?: string; sizes?: string }) {
  return (
    <div className={cn("relative shrink-0 overflow-hidden bg-surface-muted", className)}>
      {imageUrl ? (
        <Image src={resolveImageUrl(imageUrl)} alt={alt} fill sizes={sizes} className="object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-fg-subtle">
          <Package size={20} strokeWidth={1.5} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

/** A heading for a block on an account page, with an optional link on the right ("All orders"). */
export function SectionHeading({ id, title, action }: { id?: string; title: string; action?: { href: string; label: string } }) {
  return (
    <div className="mb-3.5 flex items-baseline justify-between gap-4 px-1">
      <h2 id={id} className="text-lg font-semibold tracking-tight text-fg sm:text-xl">
        {title}
      </h2>
      {action && (
        <Link href={action.href} className="shrink-0 text-sm text-fg-muted transition-colors duration-fast hover:text-fg">
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** The grouped list container: rows separated by hairlines on one rounded surface. */
export function GroupedList({ children, className, ...props }: { children: ReactNode; className?: string; "data-testid"?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-inset ring-line-subtle", className)} {...props}>
      <ul className="divide-y divide-line-subtle">{children}</ul>
    </div>
  );
}

interface ListRowProps {
  href?: string;
  onClick?: () => void;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  /** Hide the chevron (rows that don't navigate). */
  plain?: boolean;
}

/** One row of a GroupedList — a link, a button or static content. */
export function ListRow({ href, onClick, leading, title, subtitle, trailing, plain }: ListRowProps) {
  const body = (
    <>
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-fg">{title}</div>
        {subtitle && <div className="mt-0.5 text-sm text-fg-muted">{subtitle}</div>}
      </div>
      {trailing && <div className="shrink-0 text-right">{trailing}</div>}
      {!plain && (href || onClick) && <ChevronRight size={16} className="shrink-0 text-fg-subtle" aria-hidden="true" />}
    </>
  );
  const rowClass = "flex w-full items-center gap-4 px-4 py-3.5 text-left sm:px-5 sm:py-4";
  const interactive = "transition-colors duration-fast ease-smooth hover:bg-ink-900/[0.025] focus-visible:bg-ink-900/[0.035]";

  return (
    <li>
      {href ? (
        <Link href={href} className={cn(rowClass, interactive)}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={cn(rowClass, interactive)}>
          {body}
        </button>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  );
}

/** Round icon tile used at the start of a list row. `attention` marks something the customer should act on. */
export function RowIcon({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "attention" }) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
        tone === "attention" ? "bg-warning-50 text-warning-700" : "bg-surface-muted text-ink-700",
      )}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

/** Large page title for account sub-pages: display serif, left-aligned, with one line of context. */
export function AccountTitle({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <h1 className="text-balance font-display text-display-md tracking-tight text-fg sm:text-display-lg">{title}</h1>
        {description && <p className="mt-2 text-base text-fg-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
