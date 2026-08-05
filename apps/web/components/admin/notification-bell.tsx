"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, PackageX, ShoppingBag } from "lucide-react";
import * as notificationsApi from "@/lib/api/notifications";
import { cn } from "@/lib/utils";

const ICON_BY_TYPE: Record<string, typeof ShoppingBag> = {
  "order.created": ShoppingBag,
  "product.low_stock": PackageX,
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const items = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-500 transition-all duration-200 ease-smooth hover:scale-110 hover:bg-ink-100 hover:text-ink-900"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brass-400 px-1 text-[10px] font-medium text-ink-900">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="glass absolute right-0 z-50 mt-2 w-80 animate-modal-in rounded-xl border border-ink-100/70 shadow-floatLg">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
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
          <div className="max-h-96 overflow-y-auto">
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
