"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Phone, PhoneOff, ShoppingBag, UserX } from "lucide-react";
import {
  CHECKOUT_LEAD_OUTCOME_LABELS,
  CHECKOUT_LEAD_REASONS,
  CHECKOUT_LEAD_REASON_LABELS,
  checkoutLeadWhatsAppText,
  toBdInternationalDigits,
  type CheckoutLeadDto,
  type CheckoutLeadReason,
  type RecordCheckoutLeadActionInput,
} from "@clothing-brand/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ListPage } from "@/components/admin/patterns/list-page";
import { useOrderPermissions } from "@/components/admin/orders/order-domain";
import * as leadsApi from "@/lib/api/checkout-leads";
import * as settingsApi from "@/lib/api/settings";
import { getErrorMessage } from "@/lib/api-client";
import { formatCount, formatPrice, formatStoreDateTime, timeAgo } from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";

const leadKeys = {
  list: (view: "open" | "closed") => ["checkout-leads", view] as const,
  summary: ["checkout-leads", "summary"] as const,
};


/**
 * Incomplete orders (docs/INCOMPLETE_ORDERS.md): shoppers who typed their number at checkout or on a landing page and left
 * without ordering. Call in working hours (a night-time lead waits for 10:00), at most twice; WhatsApp them the link that
 * puts their bag back; or enter the order for them in one step. An order from the same number closes the lead by itself.
 */
export default function IncompleteOrdersPage() {
  const [view, setView] = useState<"open" | "closed">("open");
  const perms = useOrderPermissions();
  const list = useQuery({ queryKey: leadKeys.list(view), queryFn: () => leadsApi.listCheckoutLeads(view), refetchInterval: 60_000 });
  const summary = useQuery({ queryKey: leadKeys.summary, queryFn: () => leadsApi.getCheckoutLeadSummary(30) });
  const settings = useQuery({ queryKey: ["settings"], queryFn: settingsApi.getSettings, staleTime: 5 * 60 * 1000 });
  const storeName = settings.data?.settings.storeName ?? "";
  const leads = list.data?.leads ?? [];
  const now = Date.now();
  const due = leads.filter((l) => new Date(l.nextCallAt).getTime() <= now);

  return (
    <ListPage
      title="Incomplete orders"
      description="People who typed their number and left without ordering. Call between 10:00 and 21:00 — two tries at most."
      descriptionOnPhone
      filters={
        <div role="tablist" aria-label="Show" className="inline-flex rounded-full bg-ink-900/[0.05] p-1">
          {(["open", "closed"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              type="button"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn("min-h-[36px] rounded-full px-4 text-sm font-medium", view === v ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}
            >
              {v === "open" ? `To call${list.data && view === "open" ? ` · ${formatCount(due.length)} now` : ""}` : "Closed"}
            </button>
          ))}
        </div>
      }
    >
      {summary.data && (
        <div className="mb-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Last 30 days">
          {[
            { label: "Left without ordering", value: formatCount(summary.data.captured) },
            { label: "Ordered after all", value: formatCount(summary.data.ordered) },
            { label: "Brought in", value: formatPrice(summary.data.orderedValue) },
            {
              label: "Top reason for no",
              value: summary.data.reasons[0] ? CHECKOUT_LEAD_REASON_LABELS[summary.data.reasons[0].reason] : "—",
            },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-surface-muted px-3.5 py-3">
              <dt className="text-xs font-medium text-fg-muted">{s.label}</dt>
              <dd className="mt-0.5 truncate text-lg font-semibold tabular-nums text-fg">{s.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-fg-muted">Last 30 days. “Ordered after all” counts orders placed online or entered here.</p>
        </div>
      )}

      {list.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : list.error ? (
        <ErrorState onRetry={() => list.refetch()} />
      ) : leads.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          variant="bordered"
          title={view === "open" ? "Nobody to call right now" : "Nothing closed yet"}
          description={
            view === "open"
              ? "When someone types their number at checkout and leaves, they show up here after 15 minutes."
              : "Leads you close, and the ones that ordered, are listed here."
          }
        />
      ) : (
        <ul className="space-y-3">
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} storeName={storeName} canAct={perms.manage && view === "open"} />
          ))}
        </ul>
      )}
    </ListPage>
  );
}

function LeadCard({ lead, storeName, canAct }: { lead: CheckoutLeadDto; storeName: string; canAct: boolean }) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<"NOT_INTERESTED" | null>(null);
  const act = useMutation({
    mutationFn: (input: RecordCheckoutLeadActionInput) => leadsApi.recordCheckoutLeadAction(lead.id, input),
    onSuccess: ({ lead: after }) => {
      void queryClient.invalidateQueries({ queryKey: ["checkout-leads"] });
      toast.success(after.status === "OPEN" ? "Saved" : CHECKOUT_LEAD_OUTCOME_LABELS[after.outcome!] ?? "Closed");
    },
    onError: (err) => toast.error(getErrorMessage(err, "Couldn't save")),
  });
  const due = new Date(lead.nextCallAt).getTime() <= Date.now();
  const unavailable = lead.items.filter((i) => !i.available).length;
  const address = [lead.shippingAddressLine, lead.shippingArea, lead.shippingDistrict].filter(Boolean).join(", ");
  const waText = checkoutLeadWhatsAppText(lead, storeName || "আমাদের দোকান", lead.resumeUrl);

  return (
    <li>
      <Card className="p-4 sm:p-5" data-testid="lead-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-fg">
              {lead.name || "No name given"}
              {lead.complete && <span className="rounded-full bg-success-100 px-2 py-0.5 text-xs font-medium text-success-700">Reached the address</span>}
              {lead.earlierOrders > 0 && <span className="rounded-full bg-info-100 px-2 py-0.5 text-xs font-medium text-info-700">{lead.earlierOrders} earlier order{lead.earlierOrders === 1 ? "" : "s"}</span>}
              {lead.deliveryScore && lead.deliveryScore.successRate < 60 && (
                <span className="rounded-full bg-warning-100 px-2 py-0.5 text-xs font-medium text-warning-700">Courier score {Math.round(lead.deliveryScore.successRate)}%</span>
              )}
            </p>
            <p className="mt-0.5 text-sm tabular-nums text-fg-muted">
              {lead.phone} · {lead.source === "LANDING" ? "Landing page" : "Checkout"} · left {timeAgo(lead.lastActivityAt)}
            </p>
            {address && <p className="mt-0.5 text-sm text-fg-muted">{address}</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold tabular-nums text-fg">{formatPrice(lead.value)}</p>
            {lead.status === "OPEN" ? (
              <p className={cn("text-xs", due ? "font-medium text-warning-700" : "text-fg-muted")}>
                {due ? "Call now" : `Call from ${formatStoreDateTime(lead.nextCallAt)}`}
                {lead.attempts > 0 && ` · ${lead.attempts} unanswered`}
              </p>
            ) : (
              <p className="text-xs text-fg-muted">
                {lead.outcome ? CHECKOUT_LEAD_OUTCOME_LABELS[lead.outcome] : "Closed"}
                {lead.reason ? ` · ${CHECKOUT_LEAD_REASON_LABELS[lead.reason]}` : ""}
              </p>
            )}
          </div>
        </div>

        <ul className="mt-3 flex flex-wrap gap-2">
          {lead.items.map((item) => (
            <li key={item.variantId} className={cn("flex items-center gap-2 rounded-xl border border-line-subtle py-1.5 pl-1.5 pr-3", !item.available && "opacity-60")}>
              <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
                {item.imageUrl && <Image src={resolveImageUrl(item.imageUrl)} alt="" fill sizes="36px" className="object-cover" />}
              </span>
              <span className="text-sm">
                <span className="font-medium text-fg">{item.productName}</span>
                <span className="text-fg-muted">
                  {[item.size, item.color].filter(Boolean).length ? ` · ${[item.size, item.color].filter(Boolean).join(" / ")}` : ""} × {item.quantity}
                </span>
                {!item.available && <span className="ml-1 text-xs text-danger-600">sold out</span>}
              </span>
            </li>
          ))}
        </ul>
        {unavailable > 0 && lead.status === "OPEN" && <p className="mt-1.5 text-xs text-fg-muted">Offer another size or colour for the sold-out item.</p>}
        {lead.note && <p className="mt-2 whitespace-pre-line text-xs text-fg-subtle">{lead.note}</p>}

        {canAct && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <a href={`tel:${lead.phone}`} className={buttonVariants({ size: "sm" })}>
              <Phone size={14} aria-hidden="true" /> Call
            </a>
            <a
              href={`https://wa.me/${toBdInternationalDigits(lead.phone)}?text=${encodeURIComponent(waText)}`}
              target="_blank"
              rel="noreferrer"
              onClick={() => act.mutate({ action: "WHATSAPP_SENT" })}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <MessageCircle size={14} aria-hidden="true" /> WhatsApp
            </a>
            <Link href={`/admin/orders/new?lead=${lead.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <ShoppingBag size={14} aria-hidden="true" /> Create order
            </Link>
            <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden="true" />
            <Button variant="ghost" size="sm" disabled={act.isPending} onClick={() => act.mutate({ action: "NO_ANSWER" })}>
              <PhoneOff size={14} aria-hidden="true" /> No answer
            </Button>
            <Button variant="ghost" size="sm" disabled={act.isPending} onClick={() => setAsking("NOT_INTERESTED")}>
              <UserX size={14} aria-hidden="true" /> Not interested
            </Button>
          </div>
        )}
      </Card>
      {asking && <NotInterestedDialog busy={act.isPending} onClose={() => setAsking(null)} onSave={(input) => act.mutate(input, { onSuccess: () => setAsking(null) })} />}
    </li>
  );
}

function NotInterestedDialog({ busy, onClose, onSave }: { busy: boolean; onClose: () => void; onSave: (input: RecordCheckoutLeadActionInput) => void }) {
  const [reason, setReason] = useState<CheckoutLeadReason | null>(null);
  const [note, setNote] = useState("");
  const [noContact, setNoContact] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title="Not interested"
      description="Why didn't they order? It shows in the report, so we can fix the reason."
      widthClassName="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!reason && !noContact}
            loading={busy}
            onClick={() => onSave(noContact ? { action: "DO_NOT_CONTACT", note: note.trim() || undefined } : { action: "NOT_INTERESTED", reason: reason!, note: note.trim() || undefined })}
          >
            Close lead
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {CHECKOUT_LEAD_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={reason === r}
              onClick={() => setReason(r)}
              className={cn(
                "min-h-[40px] rounded-full border px-3.5 text-sm",
                reason === r ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-fg hover:bg-ink-900/[0.04]",
              )}
            >
              {CHECKOUT_LEAD_REASON_LABELS[r]}
            </button>
          ))}
        </div>
        <Textarea aria-label="Note" rows={2} maxLength={500} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-fg">
          <Checkbox checked={noContact} onChange={() => setNoContact((v) => !v)} />
          They asked us not to call again
        </label>
      </div>
    </Modal>
  );
}
