"use client";

import { useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Check, Inbox, Loader2, MessageCircle, Phone, RotateCcw, Trash2, UserRound } from "lucide-react";
import { isBdMobileLocal, normalizeBdPhone, toBdInternationalDigits, type ConversationDetail, type ConversationMessageRow } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { SegmentedControl } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { Pagination } from "@/components/ui/pagination";
import * as inboxApi from "@/lib/api/inbox";
import { useCapability } from "@/hooks/use-capability";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { describeApiError } from "@/lib/api-client";
import { attentionKeys } from "@/lib/query-keys";
import { formatCount, formatStoreDateTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 30;
type StatusFilter = "open" | "handled" | "all";
const STATUS: Array<{ value: StatusFilter; label: string }> = [
  { value: "open", label: "New" },
  { value: "handled", label: "Handled" },
  { value: "all", label: "All" },
];
const SMS_MAX = 600;
const inboxKeys = {
  list: ["inbox"] as const,
  thread: (id: string) => ["inbox", "thread", id] as const,
};

function DeliveryState({ message }: { message: ConversationMessageRow }) {
  if (message.delivery === "sent")
    return (
      <span className="flex items-center gap-1 text-success-700">
        <Check size={13} aria-hidden="true" /> Sent
      </span>
    );
  if (message.delivery === "failed")
    return (
      <span className="flex items-center gap-1 text-danger-600" title={message.deliveryError ?? undefined}>
        <AlertCircle size={13} aria-hidden="true" /> Not delivered{message.deliveryError ? ` — ${message.deliveryError}` : ""}
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-fg-subtle">
      <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Sending…
    </span>
  );
}

function MessageBlock({ message, contactName }: { message: ConversationMessageRow; contactName: string }) {
  const out = message.direction === "OUT";
  return (
    <li className={cn("rounded-2xl px-4 py-3", out ? "ml-6 bg-accent/[0.06] sm:ml-16" : "mr-6 bg-ink-900/[0.03] sm:mr-16")}>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[12px]">
        <span className="font-medium text-fg">
          {out ? `${message.by ?? "Staff"} · by ${message.channel === "SMS" ? "SMS" : "email"}` : contactName}
        </span>
        <span className="text-fg-subtle">{formatStoreDateTime(message.createdAt)}</span>
      </div>
      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-fg">{message.body}</p>
      {out && (
        <div className="mt-2 text-[12px]">
          <DeliveryState message={message} />
        </div>
      )}
    </li>
  );
}

function Composer({ thread }: { thread: ConversationDetail }) {
  const queryClient = useQueryClient();
  const canEmail = useCapability("inbox.replyEmail") && Boolean(thread.email);
  const canSms = useCapability("inbox.replySms") && Boolean(thread.phone);
  const [channel, setChannel] = useState<"EMAIL" | "SMS">(canEmail || !canSms ? "EMAIL" : "SMS");
  const [body, setBody] = useState("");
  const send = useMutation({
    mutationFn: () => inboxApi.replyToConversation(thread.id, { channel, body: body.trim() }),
    onSuccess: () => {
      setBody("");
      toast.success(channel === "SMS" ? "Reply queued by SMS" : "Reply queued by email");
      queryClient.invalidateQueries({ queryKey: inboxKeys.list });
      queryClient.invalidateQueries({ queryKey: attentionKeys.all });
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't send the reply")),
  });

  if (!canEmail && !canSms) {
    return (
      <p className="border-t border-line-subtle px-6 py-4 text-[13px] text-fg-muted">
        {!thread.email && !thread.phone ? (
          "This customer left no email or phone number."
        ) : (
          <>
            Email and SMS aren&apos;t set up on this store yet —{" "}
            <Link href="/admin/settings" className="text-accent hover:underline">
              Settings
            </Link>
            .
          </>
        )}
      </p>
    );
  }
  const active = channel === "EMAIL" ? canEmail : canSms;
  const tooLong = channel === "SMS" && body.trim().length > SMS_MAX;
  const ready = active && body.trim().length > 0 && !tooLong && !send.isPending;
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) {
      e.preventDefault();
      send.mutate();
    }
  };

  return (
    <form
      className="space-y-2 border-t border-line-subtle px-6 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) send.mutate();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-fg-muted">Reply by</span>
        <SegmentedControl
          aria-label="Reply by"
          value={channel}
          onChange={(v) => setChannel(v)}
          options={[
            ...(canEmail ? [{ value: "EMAIL" as const, label: "Email" }] : []),
            ...(canSms ? [{ value: "SMS" as const, label: "SMS" }] : []),
          ]}
        />
      </div>
      <label htmlFor="inbox-reply" className="sr-only">
        Your reply
      </label>
      <Textarea id="inbox-reply" rows={4} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={onKeyDown} placeholder={`Write to ${thread.contactName.split(" ")[0]}…`} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn("text-[12px]", tooLong ? "text-danger-600" : "text-fg-subtle")}>
          {channel === "SMS" ? `${formatCount(body.trim().length)}/${SMS_MAX} · to ${thread.phone}, signed with the store name` : `To ${thread.email}, with the store's email design`}
        </p>
        <Button type="submit" size="sm" disabled={!ready}>
          {send.isPending ? "Sending…" : "Send reply"}
        </Button>
      </div>
    </form>
  );
}

function Thread({ id, onBack }: { id: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirmDialog();
  const { data: thread, isLoading, isError, refetch } = useQuery({
    queryKey: inboxKeys.thread(id),
    queryFn: () => inboxApi.getConversation(id),
    // Poll while a reply is on its way, so "Sending…" turns into Sent or Not delivered by itself.
    refetchInterval: (q) => (q.state.data?.messages.some((m) => m.delivery === "sending") ? 4000 : false),
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: inboxKeys.list });
    queryClient.invalidateQueries({ queryKey: attentionKeys.all });
  };
  const status = useMutation({
    mutationFn: (next: "OPEN" | "HANDLED") => inboxApi.setConversationStatus(id, next),
    onSuccess: (_d, next) => {
      refresh();
      toast.success(next === "HANDLED" ? "Marked as handled" : "Moved back to New");
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't update the conversation")),
  });
  const remove = useMutation({
    mutationFn: () => inboxApi.deleteConversation(id),
    onSuccess: () => {
      refresh();
      toast.success("Conversation deleted");
      onBack();
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't delete the conversation")),
  });

  if (isError && !thread) return <ErrorState onRetry={() => refetch()} />;
  if (isLoading || !thread) return <div className="m-6 h-40 animate-pulse rounded-2xl bg-ink-900/[0.04]" aria-busy="true" aria-label="Loading" />;

  const mobile = thread.phone && isBdMobileLocal(normalizeBdPhone(thread.phone)) ? toBdInternationalDigits(thread.phone) : null;
  const handled = thread.status === "HANDLED";

  return (
    <article className="flex h-full min-h-0 flex-col">
      <header className="border-b border-line-subtle px-6 py-4">
        <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1 text-[13px] font-medium text-accent lg:hidden">
          <ArrowLeft size={14} aria-hidden="true" /> Inbox
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-fg">{thread.subject}</h2>
            <p className="mt-1 text-[13px] text-fg-muted">
              <span className="font-medium text-fg">{thread.contactName}</span>
              {[thread.email, thread.phone].filter(Boolean).length > 0 && <> · {[thread.email, thread.phone].filter(Boolean).join(" · ")}</>}
            </p>
            {thread.customer && (
              <Link href={`/admin/customers/${thread.customer.id}`} className="mt-1 inline-flex items-center gap-1 text-[13px] text-accent hover:underline">
                <UserRound size={13} aria-hidden="true" /> Customer with this number: {thread.customer.name}
              </Link>
            )}
          </div>
          <div className="flex items-center gap-1">
            {mobile && (
              <a href={`https://wa.me/${mobile}`} target="_blank" rel="noreferrer" aria-label="Open WhatsApp" title="WhatsApp" className="rounded-full p-2 text-fg-muted transition-colors hover:bg-ink-900/[0.05] hover:text-fg">
                <MessageCircle size={17} aria-hidden="true" />
              </a>
            )}
            {thread.phone && (
              <a href={`tel:${thread.phone}`} aria-label="Call" title="Call" className="rounded-full p-2 text-fg-muted transition-colors hover:bg-ink-900/[0.05] hover:text-fg">
                <Phone size={17} aria-hidden="true" />
              </a>
            )}
            <Button size="sm" variant="outline" disabled={status.isPending} onClick={() => status.mutate(handled ? "OPEN" : "HANDLED")}>
              {handled ? (
                <>
                  <RotateCcw size={14} aria-hidden="true" /> Move to New
                </>
              ) : (
                "Mark as handled"
              )}
            </Button>
            <button
              type="button"
              aria-label="Delete conversation"
              title="Delete conversation"
              onClick={async () => {
                if (await confirm(`Delete the conversation "${thread.subject}"? This can't be undone.`)) remove.mutate();
              }}
              className="rounded-full p-2 text-fg-subtle transition-colors hover:bg-danger-50 hover:text-danger-600"
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      <ol className="flex-1 space-y-3 overflow-y-auto px-6 py-5" aria-label="Messages">
        {thread.messages.map((m) => (
          <MessageBlock key={m.id} message={m} contactName={thread.contactName} />
        ))}
      </ol>
      <Composer key={thread.id} thread={thread} />
      {dialog}
    </article>
  );
}

/** Messages › Inbox (Blueprint V2 R2): conversations with customers, Mail-style — a list and a thread. Staff reply by
 * email or SMS from here (DR-4, owner 2026-10-08); each reply shows whether it was delivered. */
export default function InboxPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const status = STATUS.find((s) => s.value === searchParams.get("status"))?.value ?? "open";
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
    queryKey: [...inboxKeys.list, { page, status, search: debounced }],
    queryFn: () => inboxApi.listConversations({ page, pageSize: PAGE_SIZE, status, search: debounced || undefined }),
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
  });
  const items = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <PageHeader title="Inbox" description="Conversations with customers. Reply by email or SMS — every reply shows whether it arrived." />
      <ModuleTabs />
      <div className="grid overflow-hidden rounded-2xl border border-line bg-surface shadow-xs lg:h-[calc(100dvh-15rem)] lg:min-h-[520px] lg:grid-cols-[380px_1fr]">
        <section aria-label="Conversations" className={cn("flex min-h-0 flex-col border-line-subtle lg:border-r", openId && "hidden lg:flex")}>
          <div className="space-y-2 border-b border-line-subtle p-3">
            <SegmentedControl
              aria-label="Show"
              value={status}
              onChange={(value) => {
                setPage(1);
                setParam({ status: value === "open" ? null : value, open: null });
              }}
              options={STATUS.map((s) => ({ value: s.value, label: s.label }))}
            />
            <SearchInput
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Search name, phone, message…"
              aria-label="Search conversations"
            />
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
                <EmptyState icon={Inbox} title={status === "open" ? "No new messages" : "No conversations"} description={status === "open" ? "You're all caught up." : undefined} />
              </li>
            )}
            {items.map((c) => {
              const selected = c.id === openId;
              const isNew = c.status === "OPEN";
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setParam({ open: c.id })}
                    aria-current={selected ? "true" : undefined}
                    className={cn("flex w-full gap-2.5 px-4 py-3 text-left transition-colors duration-fast", selected ? "bg-accent/[0.08]" : "hover:bg-ink-900/[0.02]")}
                  >
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", isNew ? "bg-accent" : "bg-transparent")} aria-label={isNew ? "New" : undefined} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn("truncate text-[14px] text-fg", isNew && "font-semibold")}>{c.contactName}</span>
                        <span className="shrink-0 text-[12px] text-fg-subtle">{timeAgo(c.lastMessageAt)}</span>
                      </span>
                      <span className={cn("flex items-center gap-1.5 truncate text-[13px]", isNew ? "font-medium text-fg" : "text-fg-muted")}>
                        <span className="truncate">{c.subject}</span>
                        {c.messageCount > 1 && <span className="shrink-0 rounded-full bg-ink-900/[0.06] px-1.5 text-[11px] font-medium tabular-nums text-fg-muted">{c.messageCount}</span>}
                      </span>
                      <span className="block truncate text-[13px] text-fg-subtle">{c.preview}</span>
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
        <section aria-label="Conversation" className={cn("min-h-0", !openId && "hidden lg:block")}>
          {openId ? (
            <Thread key={openId} id={openId} onBack={() => setParam({ open: null })} />
          ) : (
            <div className="hidden h-full items-center justify-center text-[13px] text-fg-subtle lg:flex">Select a conversation to read it</div>
          )}
        </section>
      </div>
    </div>
  );
}
