"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, Newspaper, PackageX, ShoppingBag, Truck } from "lucide-react";
import type { NotificationView } from "@clothing-brand/shared";
import * as notificationsApi from "@/lib/api/notifications";
import { SegmentedControl } from "@/components/ui/tabs";
import { useAttentionCounts } from "@/hooks/use-attention-counts";
import { attentionKeys } from "@/lib/query-keys";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICON_BY_TYPE: Record<string, typeof ShoppingBag> = {
  "order.created": ShoppingBag,
  "product.low_stock": PackageX,
  "order.cancelled_but_paid": AlertTriangle,
  "order.overpaid": AlertTriangle,
  "order.courier_update": Truck,
  "order.courier_booked": Truck,
  "courier.attention": Truck,
  "analytics.daily_brief": Newspaper,
};

/** Two lists (shared/notification-kinds.ts): what needs a person, and the routine stream of new orders, courier updates
 * and low-stock ticks. Only the first counts on the badge, so a busy day's hundred order pings don't bury the brief. */
const EMPTY_TEXT: Record<NotificationView, string> = {
  important: "Nothing needs you right now.",
  activity: "No activity yet.",
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Tab-trap + Escape-to-close + focus-restore, matching every other overlay in the app — this
  // dropdown previously had none of the three. No scroll lock: it's a small anchored menu, not a
  // full-screen overlay, so locking page scroll behind it would be the wrong call here.
  const panelRef = useFocusTrap<HTMLDivElement>({ active: open, onEscape: () => setOpen(false), lockScroll: false });
  const queryClient = useQueryClient();
  const [view, setView] = useState<NotificationView>("important");

  const attention = useAttentionCounts();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["notifications", view],
    queryFn: () => notificationsApi.listNotifications(view),
    enabled: open,
  });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: attentionKeys.all });
  };

  const markReadMutation = useMutation({
    mutationFn: notificationsApi.markNotificationRead,
    onSuccess: invalidate,
  });
  const markAllMutation = useMutation({
    mutationFn: () => notificationsApi.markAllNotificationsRead(view),
    onSuccess: invalidate,
  });

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const items = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? attention.unreadNotifications;
  const viewUnread = view === "important" ? unreadCount : (data?.activityUnread ?? 0);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
        aria-expanded={open}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink-700 transition-colors duration-fast ease-smooth hover:bg-ink-900/[0.06] hover:text-fg"
      >
        <Bell size={18} strokeWidth={1.9} />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-500 px-1 text-[10px] font-semibold text-white ring-2 ring-surface"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
        {/* Visually hidden — announces the unread count changing (e.g. after a 30s poll picks up
            a new order) without needing the dropdown open. */}
        <span className="sr-only" role="status" aria-live="polite">
          {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}` : ""}
        </span>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Notifications"
          tabIndex={-1}
          // Fully opaque, not `.glass` — this floats over busy admin content (tables, colored
          // status pills), and translucency there let the content behind visibly bleed through
          // the notification text, hurting legibility.
          // flex-col + the header's shrink-0 + the list's min-h-0 flex-1 keeps the header pinned
          // while only the notification list scrolls, capped at 70vh so the panel never grows tall
          // enough to swallow the page underneath it. Width is viewport-aware: ~full width with a
          // margin on phones, 400px on desktop. Phones pin it under the toolbar edge to edge (less a margin) instead: the
          // bell isn't at the screen's right edge there, so a right-aligned panel would run off the left. `fixed` resolves
          // against the toolbar (its backdrop blur makes it the containing block), so 100% is the toolbar's bottom edge.
          className="absolute right-0 top-full z-50 mt-2 flex max-h-[70dvh] w-[min(92vw,400px)] flex-col overflow-hidden rounded-xl border border-ink-100/70 bg-cream-50 shadow-floatLg animate-modal-in max-md:fixed max-md:inset-x-2 max-md:top-[calc(100%+6px)] max-md:mt-0 max-md:w-auto"
        >
          <div className="flex shrink-0 flex-col gap-2.5 border-b border-ink-100 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink-900">Notifications</span>
              {viewUnread > 0 && (
                <button
                  onClick={() => markAllMutation.mutate()}
                  className="text-xs text-brass-600 hover:underline"
                  disabled={markAllMutation.isPending}
                >
                  Mark all read
                </button>
              )}
            </div>
            <SegmentedControl<NotificationView>
              aria-label="Which notifications"
              value={view}
              onChange={setView}
              options={[
                { value: "important", label: <TabLabel text="Important" count={data ? unreadCount : attention.unreadNotifications} />, testId: "notifications-important" },
                { value: "activity", label: <TabLabel text="Activity" count={data?.activityUnread ?? 0} />, testId: "notifications-activity" },
              ]}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading && <p className="px-4 py-8 text-center text-sm text-ink-400">Loading…</p>}
            {isError && (
              <div className="px-4 py-8 text-center text-sm text-ink-500">
                Couldn&rsquo;t load notifications.{" "}
                <button onClick={() => refetch()} className="text-brass-600 hover:underline">
                  Try again
                </button>
              </div>
            )}
            {data && items.length === 0 && <p className="px-4 py-8 text-center text-sm text-ink-400">{EMPTY_TEXT[view]}</p>}
            {items.map((n) => {
              const Icon = ICON_BY_TYPE[n.type] ?? Bell;
              const content = (
                <div
                  className={cn(
                    "flex gap-3 border-b border-ink-50 px-4 py-3 text-left transition-colors hover:bg-ink-50",
                    !n.readAt && "bg-brass-50/50",
                  )}
                >
                  <Icon size={16} className="mt-0.5 shrink-0 text-brass-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink-900">{n.title}</p>
                    {/* Important items (the brief, parcels needing a look) are read here, so they get their lines; the
                        routine stream stays one line each. */}
                    {n.body && <p className={cn("mt-0.5 text-xs text-ink-500", view === "important" ? "line-clamp-4 whitespace-pre-line" : "truncate")}>{n.body}</p>}
                    <p className="mt-0.5 text-[11px] text-ink-400">{timeAgo(n.createdAt)}</p>
                  </div>
                  {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brass-400" />}
                </div>
              );

              return n.link ? (
                <Link
                  key={n.id}
                  href={n.link}
                  onClick={() => {
                    setOpen(false);
                    if (!n.readAt) markReadMutation.mutate(n.id);
                  }}
                >
                  {content}
                </Link>
              ) : (
                <button
                  key={n.id}
                  className="w-full"
                  onClick={() => !n.readAt && markReadMutation.mutate(n.id)}
                >
                  {content}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TabLabel({ text, count }: { text: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {text}
      {count > 0 && <span className="text-[11px] font-semibold tabular-nums text-ink-500">{count > 99 ? "99+" : count}</span>}
    </span>
  );
}
