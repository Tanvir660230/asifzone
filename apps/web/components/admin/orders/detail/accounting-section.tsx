"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import { formatBookDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DetailSection } from "./detail-section";

/** What each commerce event means for the books, in the owner's words (also Finance › Sales accounting). */
export const EVENT_LABEL: Record<string, string> = {
  "commerce.order.recognised": "Sale and its cost recorded",
  "commerce.order.recognition_reversed": "Sale reversed",
  "commerce.payment.received": "Payment received",
  "commerce.refund.completed": "Refund paid",
  "commerce.return.restocked": "Return put back in stock",
  "commerce.return.written_off": "Return written off",
  "commerce.store_credit.entry": "Store credit",
};
export const STATUS: Record<string, { label: string; variant: "success" | "warning" | "danger" | "neutral" }> = {
  POSTED: { label: "In the books", variant: "success" },
  RECEIVED: { label: "Waiting", variant: "warning" },
  FAILED: { label: "Failed", variant: "danger" },
  IGNORED: { label: "Not needed", variant: "neutral" },
};

type Order = { id: string; orderNumber: string };

/**
 * The order's money side (docs/FINANCE_PHASE_3.md): each accounting event the order produced — sale, payment, refund,
 * return, store credit — with its journal, and any finance exception about it. Shown only to roles that read the books.
 */
export function AccountingSection({ order }: { order: Order }) {
  const { can } = useCapabilities();
  const allowed = can("finance.view");
  const q = useQuery({ queryKey: ["finance", "order-accounting", order.id], queryFn: () => financeApi.orderAccounting(order.id), enabled: allowed });
  if (!allowed) return null;
  return (
    <DetailSection
      title="Accounting"
      icon={BookOpen}
      testId="order-accounting"
      actions={<Link href="/admin/finance/sales" className="text-xs font-medium text-ink-600 hover:text-ink-900">Sales accounting</Link>}
    >
      {q.isLoading && <Skeleton className="h-16 w-full" />}
      {q.isError && <p className="text-sm text-danger-700">The books couldn&apos;t be read: {getErrorMessage(q.error, "")}</p>}
      {q.data && (
        <div className="space-y-3">
          {q.data.exceptions.filter((e) => e.status !== "RESOLVED").map((e) => (
            <Link key={e.id} href="/admin/finance/exceptions" className="flex items-start gap-2 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-800 hover:bg-warning-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0">{e.title}<span className="block text-xs text-warning-700">Finance exception · {e.status === "OPEN" ? "open — review it" : "acknowledged"}</span></span>
            </Link>
          ))}
          {q.data.events.length === 0 ? (
            <p className="text-sm text-ink-600">Not in the books yet. A sale is recorded when the order is confirmed and paid or delivered, and only from the books&apos; start date.</p>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {q.data.events.map((e) => <EventRow key={e.id} event={e} />)}
            </ul>
          )}
        </div>
      )}
    </DetailSection>
  );
}

type AccountingEvent = Awaited<ReturnType<typeof financeApi.orderAccounting>>["events"][number];

function EventRow({ event }: { event: AccountingEvent }) {
  const [open, setOpen] = useState(false);
  const status = STATUS[event.status] ?? { label: event.status.toLowerCase(), variant: "neutral" as const };
  const journal = event.journalEntry;
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={!journal}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={journal ? open : undefined}
          className={cn("flex min-w-0 items-center gap-1.5 text-left text-sm", journal ? "text-ink-900 hover:text-ink-700" : "cursor-default text-ink-900")}
        >
          {journal && (open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-400" />)}
          <span className="truncate">{EVENT_LABEL[event.eventType] ?? event.eventType}</span>
        </button>
        <span className="flex items-center gap-2 text-xs text-ink-500">
          <span className="whitespace-nowrap tabular-nums">{formatBookDate(event.financialDate)}</span>
          {journal?.number && <span className="tabular-nums">Journal #{journal.number}{journal.reversedBy?.number ? ` · reversed by #${journal.reversedBy.number}` : ""}</span>}
          <Badge variant={status.variant}>{status.label}</Badge>
        </span>
      </div>
      {event.lastError && event.status === "FAILED" && <p className="mt-1 text-xs text-danger-700">{event.lastError}</p>}
      {open && journal && <JournalLines id={journal.id} />}
    </li>
  );
}

function JournalLines({ id }: { id: string }) {
  const journal = useQuery({ queryKey: ["finance", "journal", id], queryFn: () => financeApi.getJournal(id) });
  const chart = useQuery({ queryKey: financeApi.ledgerKeys.chart(), queryFn: financeApi.listChart });
  if (journal.isLoading || chart.isLoading) return <Skeleton className="mt-2 h-12 w-full" />;
  if (journal.isError || !journal.data) return <p className="mt-2 text-xs text-danger-700">{getErrorMessage(journal.error, "The journal couldn't be loaded")}</p>;
  const name = new Map((chart.data?.accounts ?? []).map((a) => [a.id, `${a.code} ${a.name}`]));
  return (
    <ul className="mt-2 space-y-0.5 rounded-lg bg-surface-muted px-3 py-2 text-xs">
      {journal.data.lines.map((l) => (
        <li key={l.id} className="flex justify-between gap-3">
          <span className="min-w-0 truncate text-ink-700">{name.get(l.accountId) ?? "Restricted account"}</span>
          <span className="shrink-0 tabular-nums text-ink-900">{l.debit === null ? "—" : l.debit ? `Dr ${formatPrice(l.debit)}` : `Cr ${formatPrice(l.credit)}`}</span>
        </li>
      ))}
    </ul>
  );
}
