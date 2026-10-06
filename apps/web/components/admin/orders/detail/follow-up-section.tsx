"use client";

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { addDays, businessDate, businessDayStartUtc, followUpHoldBlocker, type Order } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatStoreDateTime } from "@/lib/format";
import { getStoreConfig } from "@/lib/store-config";
import type { OrderPermissions } from "../order-domain";
import { DetailSection } from "./detail-section";
import type { OrderDetailCommands } from "./use-order-detail-commands";

const QUICK_PICKS = [
  { label: "+1h", ms: 60 * 60 * 1000 },
  { label: "+2h", ms: 2 * 60 * 60 * 1000 },
  { label: "+4h", ms: 4 * 60 * 60 * 1000 },
];

/** 10:00 on the next business day in the STORE timezone (Phase 7), never the browser's. */
function nextStoreMorning(): Date {
  const { timezone } = getStoreConfig();
  return new Date(businessDayStartUtc(addDays(businessDate(new Date(), timezone), 1), timezone).getTime() + 10 * 60 * 60 * 1000);
}

/** The confirmation-call workflow: "hold, call back later" on a pending order (status unchanged, call attempts counted). */
export function FollowUpSection({ order, detail, perms }: { order: Order; detail: OrderDetailCommands; perms: OrderPermissions }) {
  const [note, setNote] = useState("");
  useEffect(() => setNote(""), [order.id]);

  const blocker = followUpHoldBlocker(order);
  // Shown for a pending order (it can be held) or any order still carrying a hold (it can be cleared).
  if (blocker && !order.followUpAt) return null;
  const due = order.followUpAt ? new Date(order.followUpAt) <= new Date() : false;
  const schedule = (at: Date) => detail.hold.mutate({ followUpAt: at, note: note || undefined }, { onSuccess: () => setNote("") });

  return (
    <DetailSection title="Confirmation call" icon={CalendarClock} testId="order-follow-up">
      <div className="space-y-3">
        {order.followUpAt ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={due ? "text-sm font-medium text-warning-800" : "text-sm text-ink-700"}>
              {due ? "Call back now — was due " : "Call back at "}
              {formatStoreDateTime(order.followUpAt)}
            </p>
            {perms.manage && !order.deletedAt && (
              <Button variant="outline" size="sm" loading={detail.clearHold.isPending} onClick={() => detail.clearHold.mutate()}>
                Clear reminder
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-600">Couldn&apos;t confirm on the call? Schedule a callback — the order stays pending and appears in “Follow-up due”.</p>
        )}
        <p className="text-xs text-ink-500">
          {order.callAttempts} call attempt{order.callAttempts === 1 ? "" : "s"} so far
        </p>
        {perms.manage && !blocker && (
          <div className="space-y-2">
            <Input aria-label="Callback note" placeholder="Note (e.g. asked to call after 6pm)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={order.followUpAt ? "Reschedule callback" : "Schedule callback"}>
              {QUICK_PICKS.map((p) => (
                <Button key={p.label} variant="outline" size="sm" disabled={detail.hold.isPending} onClick={() => schedule(new Date(Date.now() + p.ms))}>
                  {p.label}
                </Button>
              ))}
              <Button variant="outline" size="sm" disabled={detail.hold.isPending} onClick={() => schedule(nextStoreMorning())}>
                Tomorrow 10:00
              </Button>
            </div>
          </div>
        )}
      </div>
    </DetailSection>
  );
}
