"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { MessageSquareText } from "lucide-react";
import type { Order } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import type { OrderDetailCommands } from "./use-order-detail-commands";

const NOTE_MAX = 500;

/** The note printed on the parcel for the courier's rider. Before booking it shows what will be sent — the store's courier
 * notes that apply to these items plus the customer's note — and lets staff rewrite it; after booking, what was sent. */
export function CourierNotePanel({ order, detail, canEdit }: { order: Order; detail: OrderDetailCommands; canEdit: boolean }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["order-courier-note", order.id, order.updatedAt],
    queryFn: () => adminOrdersApi.getOrderCourierNote(order.id),
  });
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [order.id]);

  const heading = (
    <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
      <MessageSquareText size={13} aria-hidden="true" /> Note for the courier
    </p>
  );

  if (isLoading) {
    return (
      <div>
        {heading}
        <div className="ui-skeleton h-10 rounded-lg" aria-busy="true" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div>
        {heading}
        <p className="text-sm text-danger-600">
          Couldn&rsquo;t load the courier note.{" "}
          <button type="button" className="underline" onClick={() => refetch()}>
            Try again
          </button>
        </p>
      </div>
    );
  }

  if (data.booked) {
    return (
      <div data-testid="order-courier-note">
        {heading}
        <p className="whitespace-pre-line rounded-lg bg-surface-muted px-3 py-2 text-sm text-ink-800" lang="bn">
          {data.sent ?? <span className="text-ink-400">No note was sent.</span>}
        </p>
      </div>
    );
  }

  const editing = draft !== null;
  const customised = data.override != null;

  return (
    <div data-testid="order-courier-note">
      {heading}
      {editing ? (
        <div className="space-y-2">
          <Textarea
            rows={2}
            lang="bn"
            maxLength={NOTE_MAX}
            aria-label="Note for the courier"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto text-xs text-ink-400">
              {draft.length}/{NOTE_MAX} · leave blank to use the automatic note
            </span>
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={detail.details.isPending}
              onClick={() => detail.details.mutate({ courierNote: draft.trim() || null }, { onSuccess: () => setDraft(null) })}
            >
              Save note
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="whitespace-pre-line rounded-lg bg-surface-muted px-3 py-2 text-sm text-ink-800" lang="bn">
            {data.effective ?? <span className="text-ink-400">No note — nothing applies to these items.</span>}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
            <span>{customised ? "Written by staff for this order." : "Automatic, from the store's courier notes and the customer's note."}</span>
            {canEdit && (
              <button type="button" className="font-medium text-ink-800 underline" onClick={() => setDraft(data.effective ?? "")}>
                Edit
              </button>
            )}
            {canEdit && customised && (
              <button
                type="button"
                className="font-medium text-ink-800 underline"
                disabled={detail.details.isPending}
                onClick={() => detail.details.mutate({ courierNote: null })}
              >
                Use automatic
              </button>
            )}
            {!customised && (
              <Link href="/admin/catalog/courier-notes" className="underline">
                Manage courier notes
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
