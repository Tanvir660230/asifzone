"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Gift,
  Phone,
  MessageCircle,
  Send,
  Ban,
  ShieldAlert,
  ShoppingBag,
  Wallet,
  RotateCcw,
  Package,
  Heart,
  History,
  Radar,
} from "lucide-react";
import { normalizeBdPhone } from "@clothing-brand/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BackLink } from "@/components/ui/back-link";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { SmsComposer } from "@/components/admin/sms-composer";
import * as adminCustomersApi from "@/lib/api/admin-customers";
import { formatPrice } from "@/lib/format";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { TAG_META } from "@/lib/customer-tags";

interface CustomerDetailPanelProps {
  customerId: string;
  onClose: () => void;
  variant?: "page" | "drawer";
  /** Scrolls to and focuses the Send SMS box once the customer loads — set when opened from the
   * row's dedicated "Send SMS" action, so it does something distinct from the plain "View" action. */
  focusSms?: boolean;
}

function waLink(phone: string, message: string): string {
  const local = normalizeBdPhone(phone);
  return `https://wa.me/880${local.slice(1)}?text=${encodeURIComponent(message)}`;
}

export function CustomerDetailPanel({ customerId: id, onClose, variant = "page", focusSms }: CustomerDetailPanelProps) {
  const queryClient = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [pointsDelta, setPointsDelta] = useState("");
  const [pointsReason, setPointsReason] = useState("");
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [smsBody, setSmsBody] = useState("");
  const smsTextareaRef = useRef<HTMLTextAreaElement>(null);
  const hasAutoFocusedSms = useRef(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-customer", id],
    queryFn: () => adminCustomersApi.getCustomer(id),
  });

  useEffect(() => {
    if (!focusSms || hasAutoFocusedSms.current || !data?.customer.phone) return;
    hasAutoFocusedSms.current = true;
    smsTextareaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    smsTextareaRef.current?.focus();
  }, [focusSms, data?.customer.phone]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["admin-customer", id] });
    queryClient.invalidateQueries({ queryKey: ["admin-customers"] });
    queryClient.invalidateQueries({ queryKey: ["admin-customer-stats"] });
  }

  const adjustMutation = useMutation({
    mutationFn: () => adminCustomersApi.adjustPoints(id, Number(pointsDelta), pointsReason || undefined),
    onSuccess: () => {
      invalidate();
      toast.success("Points adjusted");
      setPointsDelta("");
      setPointsReason("");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to adjust points"),
  });

  const fieldsMutation = useMutation({
    mutationFn: (input: Parameters<typeof adminCustomersApi.updateCustomerAdminFields>[1]) =>
      adminCustomersApi.updateCustomerAdminFields(id, input),
    onSuccess: () => {
      invalidate();
      toast.success("Customer updated");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to update customer"),
  });

  const smsMutation = useMutation({
    mutationFn: () => adminCustomersApi.sendAdHocSms(id, smsBody),
    onSuccess: () => {
      invalidate();
      toast.success("SMS sent");
      setSmsBody("");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to send SMS"),
  });

  const outerClassName = variant === "page" ? "mx-auto max-w-4xl space-y-6" : "space-y-5 p-5";

  if (isLoading || !data) {
    return (
      <div className={outerClassName}>
        <p className="py-10 text-center text-sm text-ink-400">Loading…</p>
      </div>
    );
  }

  const { customer } = data;
  const notesValue = notesDraft ?? customer.adminNotes ?? "";

  async function toggleBlocked() {
    if (!customer.isBlocked) {
      const ok = await confirm(
        `Block ${customer.name}? This just flags the account for staff — it doesn't stop them from checking out.`,
        "Block",
      );
      if (!ok) return;
    }
    fieldsMutation.mutate({ isBlocked: !customer.isBlocked });
  }

  function toggleCodRisk() {
    fieldsMutation.mutate({ codRisk: !customer.codRisk });
  }

  return (
    <div className={outerClassName}>
      {variant === "page" && <BackLink onClick={onClose} label="Back to Customers" />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-sans text-2xl font-semibold tracking-tight text-ink-900">{customer.name}</h1>
          </div>
          <p className="text-sm text-ink-500">
            {customer.email ?? "No email"} · Joined {new Date(customer.createdAt).toLocaleDateString()}
          </p>
          {customer.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {customer.tags.map((tag) => {
                const meta = TAG_META[tag];
                const Icon = meta.icon;
                return (
                  <span
                    key={tag}
                    className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", meta.className)}
                  >
                    <Icon size={11} /> {meta.label}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {customer.phone && (
            <>
              <a href={`tel:${customer.phone}`}>
                <Button variant="outline" size="sm">
                  <Phone size={14} /> Call
                </Button>
              </a>
              <a href={waLink(customer.phone, `Hi ${customer.name.split(" ")[0]}, `)} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm">
                  <MessageCircle size={14} /> WhatsApp
                </Button>
              </a>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={fieldsMutation.isPending}
            onClick={toggleCodRisk}
            className={customer.codRisk ? "border-warning-400 text-warning-700" : undefined}
          >
            <ShieldAlert size={14} /> {customer.codRisk ? "Unflag COD risk" : "Flag COD risk"}
          </Button>
          <Button
            variant={customer.isBlocked ? "destructive" : "outline"}
            size="sm"
            disabled={fieldsMutation.isPending}
            onClick={toggleBlocked}
          >
            <Ban size={14} /> {customer.isBlocked ? "Unblock" : "Block"}
          </Button>
        </div>
      </div>

      {customer.riskSignals.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          <Radar size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Auto-flagged as suspicious — not proof, worth a look:</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {customer.riskSignals.map((signal) => (
                <li key={signal}>{signal}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Purchase Analytics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[
              { label: "Total orders", value: String(customer.purchaseAnalytics.totalOrders) },
              { label: "Delivered", value: String(customer.purchaseAnalytics.deliveredOrders) },
              { label: "Cancelled", value: String(customer.purchaseAnalytics.cancelledOrders) },
              { label: "Return rate", value: `${customer.purchaseAnalytics.returnRate.toFixed(0)}%` },
              { label: "Avg. order value", value: formatPrice(customer.purchaseAnalytics.averageOrderValue) },
              { label: "Lifetime spend", value: formatPrice(customer.purchaseAnalytics.lifetimeSpend) },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="text-xs uppercase tracking-wide text-ink-400">{stat.label}</p>
                <p className="mt-0.5 font-sans text-lg font-semibold tabular-nums text-ink-900">{stat.value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {customer.favoriteProducts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package size={16} className="text-info-500" /> Favorite Products
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {customer.favoriteProducts.map((p) => (
              <div key={p.name} className="flex items-center justify-between">
                <span className="text-ink-700">{p.name}</span>
                <span className="text-ink-400">×{p.quantity}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send size={16} className="text-info-500" /> Send SMS
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {customer.phone ? (
            <>
              <SmsComposer
                value={smsBody}
                onChange={setSmsBody}
                textareaRef={smsTextareaRef}
                previewContext={{
                  name: customer.name,
                  phone: customer.phone,
                  totalSpent: customer.totalSpent,
                  lastOrderAt: customer.lastOrderAt,
                }}
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={!smsBody.trim() || smsMutation.isPending}
                  onClick={() => smsMutation.mutate()}
                >
                  <Send size={14} /> Send SMS
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-400">This customer has no phone number on file.</p>
          )}
        </CardContent>
      </Card>

      {customer.smsHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History size={16} className="text-ink-500" /> SMS History
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {customer.smsHistory.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-ink-100 p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-ink-900">{entry.campaignName}</span>
                  <Badge
                    className={
                      entry.status === "SENT"
                        ? "bg-success-100 text-success-700"
                        : entry.status === "FAILED"
                          ? "bg-danger-100 text-danger-700"
                          : undefined
                    }
                  >
                    {entry.status}
                  </Badge>
                </div>
                <p className="mt-1 text-ink-600">{entry.body}</p>
                <p className="mt-1 text-xs text-ink-400">
                  {entry.sentAt ? new Date(entry.sentAt).toLocaleString() : new Date(entry.createdAt).toLocaleString()}
                  {entry.error && <span className="text-danger-600"> · {entry.error}</span>}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Internal Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            rows={3}
            placeholder="Internal notes — not visible to the customer (e.g. &quot;Wants blue color&quot;, &quot;Call before delivery&quot;)"
            value={notesValue}
            onChange={(e) => setNotesDraft(e.target.value)}
          />
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={fieldsMutation.isPending}
              onClick={() => fieldsMutation.mutate({ adminNotes: notesValue || null })}
            >
              Save notes
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Addresses ({customer.addresses.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-ink-700">
            {customer.addresses.length === 0 && <p className="text-ink-400">No saved addresses.</p>}
            {customer.addresses.map((address) => (
              <div key={address.id} className="rounded border border-ink-100 p-3">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-ink-900">{address.fullName}</p>
                  {address.isDefault && <Badge>Default</Badge>}
                </div>
                <p>{address.phone}</p>
                <p>
                  {address.addressLine}, {address.area}, {address.district}, {address.division}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift size={16} className="text-info-500" /> Reward Points
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="font-sans text-2xl font-semibold tracking-tight text-ink-900">{customer.rewardPoints.toLocaleString()}</p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder="+/- points"
                value={pointsDelta}
                onChange={(e) => setPointsDelta(e.target.value)}
                className="w-24"
              />
              <Input
                placeholder="Reason"
                value={pointsReason}
                onChange={(e) => setPointsReason(e.target.value)}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!pointsDelta || Number(pointsDelta) === 0 || adjustMutation.isPending}
                onClick={() => adjustMutation.mutate()}
              >
                Apply
              </Button>
            </div>
            {customer.pointsLedger.length > 0 && (
              <ul className="max-h-32 space-y-1 overflow-y-auto border-t border-ink-100 pt-2 text-xs text-ink-500">
                {customer.pointsLedger.map((entry) => (
                  <li key={entry.id} className="flex justify-between">
                    <span>{entry.reason}</span>
                    <span className={entry.points >= 0 ? "text-success-600" : "text-danger-600"}>
                      {entry.points >= 0 ? "+" : ""}
                      {entry.points}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingBag size={16} className="text-ink-500" /> Order History ({customer.orders.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {customer.orders.length === 0 && <p className="text-ink-400">No orders yet.</p>}
          {customer.orders.map((order) => (
            <div key={order.id} className="flex items-center justify-between rounded border border-ink-100 p-3">
              <div>
                <Link href={`/admin/orders/${order.id}`} className="text-info-600 hover:underline">
                  {order.orderNumber}
                </Link>
                <p className="text-xs text-ink-400">{new Date(order.createdAt).toLocaleDateString()}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-ink-700">
                  <Wallet size={13} className="text-ink-400" /> {formatPrice(order.total)}
                </span>
                <Badge>{order.status}</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {customer.wishlistItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Heart size={16} className="text-ink-500" /> Wishlist ({customer.wishlistItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {customer.wishlistItems.map((item) => (
              <p key={item.id}>
                <Link
                  href={`/product/${item.product.slug}`}
                  target="_blank"
                  className="text-info-600 hover:underline"
                >
                  {item.product.name}
                </Link>
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {customer.timeline.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RotateCcw size={16} className="text-ink-500" /> Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 border-l border-ink-100 pl-4">
              {customer.timeline.slice(0, 25).map((entry, i) => (
                <li key={i} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-ink-400" />
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink-900">{entry.label}</span>
                    <span className="text-xs text-ink-400">{new Date(entry.date).toLocaleString()}</span>
                  </div>
                  {entry.detail && <p className="mt-0.5 text-ink-600">{entry.detail}</p>}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
      {confirmDialog}
    </div>
  );
}
