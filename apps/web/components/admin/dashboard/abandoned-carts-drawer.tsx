"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, PhoneOff, Send, ShoppingCart } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SmsComposer } from "@/components/admin/sms-composer";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";
import { adminCan } from "@/lib/auth";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import * as analyticsApi from "@/lib/api/admin-analytics";
import { formatPrice, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const DEFAULT_MESSAGE = "Hi {{first_name}}, you left something in your cart. Complete your order before it sells out: {{website}}";

/** Abandoned carts as a recovery list: who left what, and a reminder SMS to the ones who opted in to marketing SMS. */
export function AbandonedCartsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: me } = useCurrentAdmin();
  const canMessage = adminCan(me?.admin, "customers.message");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [body, setBody] = useState(DEFAULT_MESSAGE);

  const { data, isLoading } = useQuery({
    queryKey: ["abandoned-carts"],
    queryFn: () => analyticsApi.listAbandonedCarts(100),
    enabled: open,
    // A refetch re-runs the pre-selection below; don't let a window refocus wipe a selection mid-compose.
    refetchOnWindowFocus: false,
  });
  const carts = useMemo(() => data?.carts ?? [], [data]);
  const reachable = carts.filter((c) => c.reachable);

  // Opening pre-selects everyone reachable who hasn't been reminded yet — the usual "nudge the new ones" pass.
  useEffect(() => {
    if (open && data) setSelected(new Set(data.carts.filter((c) => c.reachable && !c.reminderSentAt).map((c) => c.customerId)));
  }, [open, data]);

  const remind = useMutation({
    mutationFn: () => analyticsApi.remindAbandonedCarts(Array.from(selected), body),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["abandoned-carts"] });
      if (r.failed === 0) toast.success(`Reminder sent to ${r.sent} customer${r.sent === 1 ? "" : "s"}${r.skipped ? ` · ${r.skipped} skipped` : ""}`);
      else toast.error(`${r.sent} sent, ${r.failed} failed${r.skipped ? `, ${r.skipped} skipped` : ""}`);
      setSelected(new Set());
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Couldn't send reminders"),
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allReachableSelected = reachable.length > 0 && reachable.every((c) => selected.has(c.customerId));
  const totalValue = carts.reduce((s, c) => s + c.value, 0);
  const firstSelected = carts.find((c) => selected.has(c.customerId));

  return (
    <Drawer open={open} onClose={onClose} title="Abandoned carts" widthClassName="max-w-xl">
      <div className="space-y-5 px-5 py-5 sm:px-6">
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Carts", value: String(carts.length) },
            { label: "Potential", value: formatPrice(totalValue) },
            { label: "Can be reminded", value: String(reachable.length) },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-surface-muted px-3.5 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{s.label}</p>
              <p className="mt-0.5 truncate text-lg font-semibold tabular-nums text-ink-900">{isLoading ? "…" : s.value}</p>
            </div>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 rounded-xl ui-skeleton" />
            ))}
          </div>
        ) : carts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <ShoppingCart size={22} className="text-ink-300" />
            <p className="text-sm text-ink-500">No abandoned carts right now.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line-subtle">
            {canMessage && (
              <label className="flex cursor-pointer items-center gap-3 border-b border-line-subtle bg-surface-muted px-4 py-2.5 text-xs font-medium text-ink-600">
                <Checkbox
                  checked={allReachableSelected}
                  disabled={reachable.length === 0}
                  onChange={() => setSelected(allReachableSelected ? new Set() : new Set(reachable.map((c) => c.customerId)))}
                />
                Select everyone who can be reminded ({reachable.length})
              </label>
            )}
            <ul className="max-h-[42vh] divide-y divide-line-subtle overflow-y-auto">
              {carts.map((c) => (
                <li key={c.cartId} className={cn("flex items-center gap-3 px-4 py-3", !c.reachable && "bg-ink-50/40")}>
                  {canMessage && (
                    <Checkbox
                      checked={selected.has(c.customerId)}
                      disabled={!c.reachable}
                      onChange={() => toggle(c.customerId)}
                      aria-label={`Select ${c.name}`}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/customers/${c.customerId}`} className="block truncate text-sm font-medium text-ink-900 hover:underline">
                      {c.name}
                    </Link>
                    <p className="truncate text-xs text-ink-500">
                      {c.firstItemName ?? "—"}
                      {c.itemCount > 1 ? ` · ${c.itemCount} items` : ""} · left {timeAgo(c.updatedAt)}
                    </p>
                    {!c.reachable ? (
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-400">
                        <PhoneOff size={11} /> {c.phone ? "Not opted in to SMS" : "No phone number"}
                      </p>
                    ) : c.reminderSentAt ? (
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-success-600">
                        <BellRing size={11} /> Reminded {timeAgo(c.reminderSentAt)}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-900">{formatPrice(c.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {canMessage && carts.length > 0 && (
          <div className="space-y-3 rounded-xl border border-line-subtle p-4">
            <p className="text-sm font-medium text-ink-900">Reminder message</p>
            <SmsComposer
              value={body}
              onChange={setBody}
              previewContext={firstSelected ? { name: firstSelected.name, phone: firstSelected.phone } : undefined}
              previewLabel="first selected customer"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-ink-400">Only customers with a phone and SMS marketing opt-in are messaged.</p>
              <Button size="sm" disabled={selected.size === 0 || !body.trim() || remind.isPending} onClick={() => remind.mutate()}>
                <Send size={14} /> {remind.isPending ? "Sending…" : `Send to ${selected.size}`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
