import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Tahafi's signature: a garment hang-tag on a brass thread. Its lines are the store's own words (Admin → Homepage → Hero →
 * small line above the headline), split at " | " — "Utility Jacket | Olive cotton twill | ৳2,950" reads as name, detail
 * and price. It hangs from the top edge of whatever positioned box contains it.
 */
export function HangTag({ text, href, className }: { text: string; href?: string | null; className?: string }) {
  const [title, ...rest] = text.split("|").map((part) => part.trim()).filter(Boolean);
  const last = rest.length > 1 ? rest[rest.length - 1] : null;
  const middle = last ? rest.slice(0, -1) : rest;
  const body = (
    <>
      <span aria-hidden="true" className="absolute left-1/2 top-2.5 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-ink-950/80" />
      <span className="block text-[0.8125rem] leading-snug text-ink-700">{title}</span>
      {middle.map((line) => (
        <span key={line} className="mt-0.5 block text-sm leading-snug text-ink-900">
          {line}
        </span>
      ))}
      {last && <span className="mt-2 block text-lg font-semibold tabular-nums text-ink-900">{last}</span>}
    </>
  );
  const tagClass =
    "ui-hang-tag relative block w-36 origin-top rotate-[5deg] bg-cream-50 px-4 pb-4 pt-7 text-left transition-transform duration-300 ease-smooth sm:w-40 [@media(hover:hover)]:hover:rotate-[2deg]";
  return (
    <div className={cn("pointer-events-none absolute right-6 top-0 z-10 flex flex-col items-center sm:right-10", className)}>
      <span aria-hidden="true" className="h-20 w-px bg-[color:var(--tag-thread)] sm:h-28" />
      {href ? (
        <Link href={href} className={cn(tagClass, "pointer-events-auto -mt-px focus-visible:outline-offset-4")}>
          {body}
        </Link>
      ) : (
        <span className={cn(tagClass, "-mt-px")}>{body}</span>
      )}
    </div>
  );
}
