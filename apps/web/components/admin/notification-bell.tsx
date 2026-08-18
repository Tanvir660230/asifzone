"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, PackageX, ShoppingBag } from "lucide-react";
import * as notificationsApi from "@/lib/api/notifications";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICON_BY_TYPE: Record<string, typeof ShoppingBag> = {
  "order.created": ShoppingBag,
  "product.low_stock": PackageX,
  "order.cancelled_but_paid": AlertTriangle,
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Tab-trap + Escape-to-close + focus-restore, matching every other overlay in the app — this
  // dropdown previously had none of the three. No scroll lock: it's a small anchored menu, not a
  // full-screen overlay, so locking page scroll behind it would be the wrong call here.
  const panelRef = useFocusTrap<HTMLDivElement>({ active: open, onEscape: () => setOpen(false), lockScroll: false });
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: notificationsApi.listNotifications,
    refetchInterval: 30_000,
  });

  const markReadMutation = useMutation({
    mutationFn: notificationsApi.markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markAllMutation = useMutation({
    mutationFn: notificationsApi.markAllNotificationsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const items = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-500 transition-all duration-200 ease-smooth hover:scale-110 hover:bg-ink-100 hover:text-ink-900"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brass-400 px-1 text-[10px] font-medium text-ink-900"
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
          // margin on phones, 400px on desktop.
          className="absolute right-0 top-full z-50 mt-2 flex max-h-[70vh] w-[min(92vw,400px)] flex-col overflow-hidden rounded-xl border border-ink-100/70 bg-cream-50 shadow-floatLg animate-modal-in"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-ink-100 px-4 py-3">
            <span className="text-sm font-medium text-ink-900">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllMutation.mutate()}
                className="text-xs text-brass-600 hover:underline"
                disabled={markAllMutation.isPending}
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {items.length === 0 && <p className="px-4 py-8 text-center text-sm text-ink-400">No notifications yet.</p>}
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
                    {n.body && <p className="mt-0.5 truncate text-xs text-ink-500">{n.body}</p>}
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
