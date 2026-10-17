"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Check, Clock, Inbox, Loader2, MessageCircle, Phone, RotateCcw, Sparkles, Trash2, UserCheck, UserRound } from "lucide-react";
import {
  CONVERSATION_CHANNELS,
  isBdMobileLocal,
  normalizeBdPhone,
  toBdInternationalDigits,
  type ConversationChannelName,
  type ConversationDetail,
  type ConversationMessageRow,
  type ReplyChannel,
} from "@clothing-brand/shared";
import { CHANNEL_FILTERS, CHANNEL_META, ChannelIcon, INTENT_LABEL, replyChannelLabel, timeUntil } from "@/components/admin/inbox/channel";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useCurrentAdmin } from "@/hooks/use-current-admin";
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
const REPLY_MAX = 2000;
const SOCIAL_THREADS: ReadonlySet<ConversationChannelName> = new Set(["WHATSAPP", "MESSENGER", "INSTAGRAM", "FB_COMMENT"]);
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

function outLabel(message: ConversationMessageRow, thread: ConversationDetail["channel"]): string {
  const via = replyChannelLabel(message.channel as ReplyChannel, thread);
  if (message.author === "AI") return `AI auto-reply · ${via}`;
  if (message.author === "PHONE") return `Replied from the phone · ${via}`;
  return `${message.by ?? "Staff"} · ${via}`;
}

function MessageBlock({ message, contactName, thread }: { message: ConversationMessageRow; contactName: string; thread: ConversationDetail["channel"] }) {
  const out = message.direction === "OUT";
  return (
    <li className={cn("rounded-2xl px-4 py-3", out ? "ml-6 bg-accent/[0.06] sm:ml-16" : "mr-6 bg-ink-900/[0.03] sm:mr-16")}>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[12px]">
        <span className="flex items-center gap-1 font-medium text-fg">
          {out && message.author === "AI" && <Sparkles size={12} className="text-accent" aria-hidden="true" />}
          {out ? outLabel(message, thread) : contactName}
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

/** What the reply on `channel` will do, under the text box. */
function deliveryHint(channel: ReplyChannel, thread: ConversationDetail, length: number): string {
  switch (channel) {
    case "SMS":
      return `${formatCount(length)}/${SMS_MAX} · to ${thread.phone}, signed with the store name`;
    case "EMAIL":
      return `To ${thread.email}, with the store's email design`;
    case "FB_COMMENT":
      return "Posted publicly under their comment";
    case "MESSENGER":
      return thread.channel === "FB_COMMENT" ? "Opens a Messenger chat with them — once per comment" : "On Messenger";
    case "INSTAGRAM":
      return "As an Instagram DM";
    default:
      return thread.phone ? `On WhatsApp to ${thread.phone}` : "On WhatsApp";
  }
}

/** The reply window of the channel being written on: a quiet countdown, a note about Meta's human-agent rule, or why
 * it's closed. Comments, email and SMS have none. */
function WindowNote({ thread, channel }: { thread: ConversationDetail; channel: ReplyChannel }) {
  if (channel !== "WHATSAPP" && channel !== "MESSENGER" && channel !== "INSTAGRAM") return null;
  if (thread.channel === "FB_COMMENT") return null;
  const w = thread.replyWindow;
  if (!w.open) {
    return (
      <p className="flex items-start gap-1.5 rounded-lg bg-warning-50 px-3 py-2 text-[13px] text-warning-800">
        <Clock size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        {channel === "WHATSAPP"
          ? `WhatsApp only allows replies within 24 hours of the customer's last message.${thread.phone ? " Reply by SMS instead, or wait for them to write again." : " Wait for them to write again."}`
          : `${CHANNEL_META[channel].label} only allows replies within 7 days of the customer's last message.`}
      </p>
    );
  }
  if (w.humanAgentTag) {
    return <p className="text-[12px] text-fg-muted">More than 24 hours since their last message — this goes out as a staff reply, allowed for 7 days.</p>;
  }
  const left = w.closesAt ? timeUntil(w.closesAt) : null;
  return left ? (
    <p className="flex items-center gap-1 text-[12px] text-fg-subtle">
      <Clock size={12} aria-hidden="true" /> Reply window closes in {left}
    </p>
  ) : null;
}

function Composer({ thread }: { thread: ConversationDetail }) {
  const queryClient = useQueryClient();
  const canEmail = useCapability("inbox.replyEmail");
  const canSms = useCapability("inbox.replySms");
  const canSocial = useCapability("inbox.replySocial");
  const options = thread.replyChannels.filter((c) => (c === "EMAIL" ? canEmail : c === "SMS" ? canSms : canSocial));
  // On a comment, the AI's draft is the private answer (prices in public invite haggling) — so start there.
  const [channel, setChannel] = useState<ReplyChannel | undefined>(
    thread.channel === "FB_COMMENT" && thread.draft && options.includes("MESSENGER") ? "MESSENGER" : options[0],
  );
  const [body, setBody] = useState(thread.draft?.body ?? "");
  const [draft, setDraft] = useState(thread.draft);
  // A new AI draft (the customer wrote again) fills an empty box; what staff are typing is never replaced.
  useEffect(() => {
    setDraft(thread.draft);
    if (thread.draft) setBody((current) => (current.trim() ? current : thread.draft!.body));
  }, [thread.draft]);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: inboxKeys.list });
    queryClient.invalidateQueries({ queryKey: inboxKeys.thread(thread.id) });
    queryClient.invalidateQueries({ queryKey: attentionKeys.all });
  };
  const send = useMutation({
    mutationFn: () => inboxApi.replyToConversation(thread.id, { channel: channel!, body: body.trim() }),
    onSuccess: () => {
      setBody("");
      setDraft(null);
      toast.success(`Reply queued · ${replyChannelLabel(channel!, thread.channel)}`);
      refresh();
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't send the reply")),
  });
  const discard = useMutation({
    mutationFn: () => inboxApi.discardDraft(thread.id),
    onSuccess: () => {
      if (body === draft?.body) setBody("");
      setDraft(null);
      refresh();
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't discard the draft")),
  });

  if (!channel) {
    return (
      <p className="border-t border-line-subtle px-6 py-4 text-[13px] text-fg-muted">
        {thread.replyChannels.length === 0 ? (
          "This customer left no way to reply."
        ) : (
          <>
            Replies on this channel aren&apos;t set up on this store yet —{" "}
            <Link href="/admin/settings" className="text-accent hover:underline">
              Settings
            </Link>
            .
          </>
        )}
      </p>
    );
  }
  const max = channel === "SMS" ? SMS_MAX : REPLY_MAX;
  const tooLong = body.trim().length > max;
  const closed = (channel === "WHATSAPP" || channel === "MESSENGER" || channel === "INSTAGRAM") && thread.channel !== "FB_COMMENT" && !thread.replyWindow.open;
  const ready = !closed && body.trim().length > 0 && !tooLong && !send.isPending;
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
        <span className="text-[13px] text-fg-muted">Reply on</span>
        {options.length > 1 ? (
          <SegmentedControl aria-label="Reply on" value={channel} onChange={(v) => setChannel(v)} options={options.map((c) => ({ value: c, label: replyChannelLabel(c, thread.channel) }))} />
        ) : (
          <span className="text-[13px] font-medium text-fg">{replyChannelLabel(channel, thread.channel)}</span>
        )}
      </div>
      <WindowNote thread={thread} channel={channel} />
      <div aria-live="polite">
        {draft && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <span className="flex items-center gap-1 font-medium text-accent">
              <Sparkles size={12} aria-hidden="true" /> AI draft · {INTENT_LABEL[draft.intent] ?? draft.intent}
              <span className="font-normal text-fg-subtle">— check it, then send</span>
            </span>
            <button type="button" className="font-medium text-fg-muted hover:text-fg hover:underline" disabled={discard.isPending} onClick={() => discard.mutate()}>
              Discard draft
            </button>
          </div>
        )}
      </div>
      <label htmlFor="inbox-reply" className="sr-only">
        Your reply
      </label>
      <Textarea
        id="inbox-reply"
        rows={4}
        value={body}
        disabled={closed}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={`Write to ${thread.contactName.split(" ")[0]}…`}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn("text-[12px]", tooLong ? "text-danger-600" : "text-fg-subtle")}>
          {tooLong ? `${formatCount(body.trim().length)}/${max} — too long` : deliveryHint(channel, thread, body.trim().length)}
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
  const { data: currentAdmin } = useCurrentAdmin();
  const { confirm, dialog } = useConfirmDialog();
  const { data: thread, isLoading, isError, refetch } = useQuery({
    queryKey: inboxKeys.thread(id),
    queryFn: () => inboxApi.getConversation(id),
    // Poll while a reply is on its way, so "Sending…" turns into Sent or Not delivered by itself; a chat (WhatsApp,
    // Messenger…) also keeps listening for the customer's next message and the AI's draft.
    refetchInterval: (q) =>
      q.state.data?.messages.some((m) => m.delivery === "sending") ? 4000 : q.state.data && SOCIAL_THREADS.has(q.state.data.channel) ? 15_000 : false,
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: inboxKeys.list });
    queryClient.invalidateQueries({ queryKey: attentionKeys.all });
  };
  const status = useMutation({
    mutationFn: (next: "OPEN" | "HANDLED") => inboxApi.updateConversation(id, { status: next }),
    onSuccess: (_d, next) => {
      refresh();
      toast.success(next === "HANDLED" ? "Marked as handled" : "Moved back to New");
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't update the conversation")),
  });
  const assign = useMutation({
    mutationFn: (toMe: boolean) => inboxApi.updateConversation(id, { assignedToMe: toMe }),
    onSuccess: (_d, toMe) => {
      refresh();
      queryClient.invalidateQueries({ queryKey: inboxKeys.thread(id) });
      toast.success(toMe ? "Assigned to you" : "Unassigned");
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

  const me = currentAdmin?.admin.id;
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
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-fg">
              <ChannelIcon channel={thread.channel} size={17} className="text-fg-muted" />
              {thread.subject}
            </h2>
            <p className="mt-1 text-[13px] text-fg-muted">
              <span className="font-medium text-fg">{thread.contactName}</span>
              {[thread.email, thread.phone].filter(Boolean).length > 0 && <> · {[thread.email, thread.phone].filter(Boolean).join(" · ")}</>}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-fg-muted">
              <UserCheck size={13} aria-hidden="true" />
              {thread.assignedTo ? <>Handled by {thread.assignedTo.id === me ? "you" : thread.assignedTo.name}</> : "Not assigned"}
              {thread.assignedTo?.id === me ? (
                <button type="button" className="font-medium text-accent hover:underline" disabled={assign.isPending} onClick={() => assign.mutate(false)}>
                  Unassign
                </button>
              ) : (
                <button type="button" className="font-medium text-accent hover:underline" disabled={assign.isPending} onClick={() => assign.mutate(true)}>
                  Assign to me
                </button>
              )}
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
          <MessageBlock key={m.id} message={m} contactName={thread.contactName} thread={thread.channel} />
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
  const mine = searchParams.get("mine") === "true";
  const channelParam = searchParams.get("channel");
  const channel = CONVERSATION_CHANNELS.find((c) => c === channelParam);
  const { data: currentAdmin } = useCurrentAdmin();
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
    queryKey: [...inboxKeys.list, { page, status, mine, channel, search: debounced }],
    queryFn: ({ signal }) =>
      inboxApi.listConversations({ page, pageSize: PAGE_SIZE, status, mine: mine ? "true" : undefined, channel, search: debounced || undefined }, { signal }),
    placeholderData: (prev) => prev,
    // WhatsApp and Messenger customers expect a quick answer — new chats show up within seconds.
    refetchInterval: 15_000,
  });
  const items = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <PageHeader title="Inbox" description="WhatsApp, Messenger, Instagram, post comments and the website form in one place. Every reply shows whether it arrived." />
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
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-[13px] text-fg-muted">
                <Checkbox
                  checked={mine}
                  onChange={(e) => {
                    setPage(1);
                    setParam({ mine: e.target.checked ? "true" : null, open: null });
                  }}
                />
                Assigned to me
              </label>
              <label htmlFor="inbox-channel" className="sr-only">
                Channel
              </label>
              <Select
                id="inbox-channel"
                className="h-8 w-auto py-0 text-[13px]"
                value={channel ?? ""}
                onChange={(e) => {
                  setPage(1);
                  setParam({ channel: e.target.value || null, open: null });
                }}
              >
                <option value="">All channels</option>
                {CHANNEL_FILTERS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
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
                        <ChannelIcon channel={c.channel} size={13} className="text-fg-subtle" />
                        <span className="truncate">{c.subject}</span>
                        {c.messageCount > 1 && <span className="shrink-0 rounded-full bg-ink-900/[0.06] px-1.5 text-[11px] font-medium tabular-nums text-fg-muted">{c.messageCount}</span>}
                        {c.hasDraft && (
                          <span className="ml-auto flex shrink-0 items-center gap-0.5 rounded-full bg-accent/[0.08] px-1.5 text-[11px] font-medium text-accent">
                            <Sparkles size={10} aria-hidden="true" /> Draft
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[13px] text-fg-subtle">{c.preview}</span>
                      {c.assignedTo && <span className="mt-0.5 block truncate text-[12px] text-fg-subtle">Handled by {c.assignedTo.id === currentAdmin?.admin.id ? "you" : c.assignedTo.name}</span>}
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
