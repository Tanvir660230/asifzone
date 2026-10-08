"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Inbox, Mail, MessageCircle, Phone, Trash2 } from "lucide-react";
import { isBdMobileLocal, normalizeBdPhone, toBdInternationalDigits, type Feedback, type FeedbackStatusFilter } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { Pagination } from "@/components/ui/pagination";
import * as adminFeedbackApi from "@/lib/api/admin-feedback";
import * as settingsApi from "@/lib/api/settings";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { describeApiError } from "@/lib/api-client";
import { attentionKeys } from "@/lib/query-keys";
import { formatCount, formatStoreDateTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 30;
const STATUS: Array<{ value: FeedbackStatusFilter; label: string }> = [
  { value: "unread", label: "New" },
  { value: "read", label: "Handled" },
  { value: "all", label: "All" },
];

/** Reply links that open outside the Store Console (Blueprint V2 Inbox R1 — no reply model yet). */
function replyLinks(f: Feedback, storeName: string) {
  const greeting = `Hi ${f.name.split(" ")[0]}, thank you for contacting ${storeName}.`;
  const mobile = f.phone && isBdMobileLocal(normalizeBdPhone(f.phone)) ? toBdInternationalDigits(f.phone) : null;
  return {
    email: f.email ? `mailto:${f.email}?subject=${encodeURIComponent(`Re: ${f.subject}`)}&body=${encodeURIComponent(`${greeting}\n\n`)}` : null,
    whatsapp: mobile ? `https://wa.me/${mobile}?text=${encodeURIComponent(greeting)}` : null,
    call: f.phone ? `tel:${f.phone}` : null,
  };
}

function Reader({ message, onBack }: { message: Feedback; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirmDialog();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-feedback"] });
    queryClient.invalidateQueries({ queryKey: attentionKeys.all });
  };
  const handled = useMutation({
    mutationFn: adminFeedbackApi.markFeedbackRead,
    onSuccess: () => {
      refresh();
      toast.success("Marked as handled");
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't update the message")),
  });
  const remove = useMutation({
    mutationFn: adminFeedbackApi.deleteFeedback,
    onSuccess: () => {
      refresh();
      toast.success("Message deleted");
      onBack();
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't delete the message")),
  });
  // The same cached settings query the sidebar's store name uses — no extra request.
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: settingsApi.getSettings, staleTime: 5 * 60 * 1000 });
  const links = replyLinks(message, settings?.settings.storeName ?? "our store");

  return (
    <article className="flex h-full flex-col">
      <header className="border-b border-line-subtle px-6 py-4">
        <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1 text-[13px] font-medium text-accent lg:hidden">
          <ArrowLeft size={14} aria-hidden="true" /> Inbox
        </button>
        <h2 className="text-lg font-semibold tracking-tight text-fg">{message.subject}</h2>
        <p className="mt-1 text-[13px] text-fg-muted">
          <span className="font-medium text-fg">{message.name}</span>
          {[message.email, message.phone].filter(Boolean).length > 0 && <> · {[message.email, message.phone].filter(Boolean).join(" · ")}</>}
        </p>
        <p className="mt-0.5 text-[12px] text-fg-subtle">{formatStoreDateTime(message.createdAt)}</p>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-fg">{message.message}</p>
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t border-line-subtle px-6 py-4">
        {links.email && (
          <a href={links.email} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-medium text-accent-fg hover:bg-accent-hover">
            <Mail size={15} aria-hidden="true" /> Reply by email
          </a>
        )}
        {links.whatsapp && (
          <a href={links.whatsapp} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-[13px] font-medium text-fg hover:border-line-strong">
            <MessageCircle size={15} aria-hidden="true" /> WhatsApp
          </a>
        )}
        {links.call && (
          <a href={links.call} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-[13px] font-medium text-fg hover:border-line-strong">
            <Phone size={15} aria-hidden="true" /> Call
          </a>
        )}
        <span className="flex-1" />
        {message.readAt ? (
          <span className="flex items-center gap-1 text-[13px] text-success-700">
            <CheckCircle2 size={15} aria-hidden="true" /> Handled
          </span>
        ) : (
          <Button size="sm" variant="outline" disabled={handled.isPending} onClick={() => handled.mutate(message.id)}>
            Mark as handled
          </Button>
        )}
        <button
          type="button"
          aria-label="Delete message"
          title="Delete message"
          onClick={async () => {
            if (await confirm(`Delete the message "${message.subject}"? This can't be undone.`)) remove.mutate(message.id);
          }}
          className="rounded-full p-2 text-fg-subtle transition-colors hover:bg-danger-50 hover:text-danger-600"
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </footer>
      {dialog}
    </article>
  );
}

/** Messages › Inbox (Blueprint V2 R1): website contact messages, Mail-style — a list and a reading pane. Replies open
 * email, WhatsApp or a call outside the Store Console; "handled" is the message's read state. */
export default function InboxPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const status = (STATUS.find((s) => s.value === searchParams.get("status"))?.value ?? "unread") as FeedbackStatusFilter;
  const openId = searchParams.get("open");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search, 350);

  const setParam = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) if (v === null) q.delete(k);
    else q.set(k, v);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-feedback", { page, pageSize: PAGE_SIZE, status, search: debounced }],
    queryFn: () => adminFeedbackApi.listFeedback({ page, pageSize: PAGE_SIZE, status, search: debounced || undefined }),
    placeholderData: (prev) => prev,
  });
  const items = data?.items ?? [];
  const open = items.find((f) => f.id === openId) ?? null;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <PageHeader title="Inbox" description="Messages customers sent from the store's contact form." />
      <ModuleTabs />
      <div className="grid overflow-hidden rounded-2xl border border-line bg-surface shadow-xs lg:h-[calc(100dvh-15rem)] lg:min-h-[480px] lg:grid-cols-[380px_1fr]">
        <section aria-label="Messages" className={cn("flex min-h-0 flex-col border-line-subtle lg:border-r", open && "hidden lg:flex")}>
          <div className="space-y-2 border-b border-line-subtle p-3">
            <SegmentedControl
              aria-label="Show"
              value={status}
              onChange={(value) => {
                setPage(1);
                setParam({ status: value === "unread" ? null : value, open: null });
              }}
              options={STATUS.map((s) => ({ value: s.value, label: s.label }))}
            />
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name, email, subject…" aria-label="Search messages" />
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-line-subtle overflow-y-auto">
            {isLoading && !data && Array.from({ length: 6 }).map((_, i) => <li key={i} className="m-3 h-14 animate-pulse rounded-lg bg-ink-900/[0.04]" />)}
            {isError && !data && (
              <li>
                <ErrorState onRetry={() => refetch()} />
              </li>
            )}
            {data && items.length === 0 && (
              <li>
                <EmptyState icon={Inbox} title={status === "unread" ? "No new messages" : "No messages"} description={status === "unread" ? "You're all caught up." : undefined} />
              </li>
            )}
            {items.map((f) => {
              const selected = f.id === openId;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => setParam({ open: f.id })}
                    aria-current={selected ? "true" : undefined}
                    className={cn("flex w-full gap-2.5 px-4 py-3 text-left transition-colors duration-fast", selected ? "bg-accent/[0.08]" : "hover:bg-ink-900/[0.02]")}
                  >
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", f.readAt ? "bg-transparent" : "bg-accent")} aria-label={f.readAt ? undefined : "New"} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn("truncate text-[14px] text-fg", !f.readAt && "font-semibold")}>{f.name}</span>
                        <span className="shrink-0 text-[12px] text-fg-subtle">{timeAgo(f.createdAt)}</span>
                      </span>
                      <span className={cn("block truncate text-[13px]", f.readAt ? "text-fg-muted" : "font-medium text-fg")}>{f.subject}</span>
                      <span className="block truncate text-[13px] text-fg-subtle">{f.message}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {data && data.total > data.pageSize && (
            <div className="flex items-center justify-between gap-2 border-t border-line-subtle px-3 py-2 text-xs text-fg-muted">
              <span className="tabular-nums">{formatCount(data.total)}</span>
              <Pagination page={page} totalPages={totalPages} onChange={setPage} className="mt-0" />
            </div>
          )}
        </section>
        <section aria-label="Message" className={cn("min-h-0", !open && "hidden lg:block")}>
          {open ? (
            <Reader key={open.id} message={open} onBack={() => setParam({ open: null })} />
          ) : (
            <div className="hidden h-full items-center justify-center text-[13px] text-fg-subtle lg:flex">Select a message to read it</div>
          )}
        </section>
      </div>
    </div>
  );
}
