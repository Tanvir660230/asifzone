"use client";

import { use, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, PackageCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { StorefrontPage, StorefrontPageHeader } from "@/components/storefront/storefront-page";
import { ApiError } from "@/lib/api-client";
import { actOnSelfConfirm, getSelfConfirm, type SelfConfirmView } from "@/lib/api/orders";
import { formatPrice } from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";

/** What an order that can no longer be confirmed here says — every state the link can meet. */
const DONE_TEXT: Record<string, { title: string; body: string; tone: "ok" | "off" }> = {
  CONFIRMED: { title: "Your order is confirmed", body: "Thank you! We're getting it ready and will send it out soon.", tone: "ok" },
  CANCELLED: { title: "This order is cancelled", body: "If that's a mistake, just order again — or contact us.", tone: "off" },
};
const doneText = (status: string) =>
  DONE_TEXT[status] ?? { title: "Your order is on its way", body: "It's already past confirmation — you can follow it with Track order.", tone: "ok" as const };

/**
 * The customer's confirm-your-order page, from the link in the order-placed SMS. One tap confirms (no call needed); cancel
 * asks first. Every figure comes from the server, and the page shows only what's needed to recognise the order — no
 * phone or address line. The signed code in the URL is the only key.
 */
export default function SelfConfirmPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirmDialog();
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading, error: loadError } = useQuery({ queryKey: ["self-confirm", code], queryFn: () => getSelfConfirm(code), retry: false });
  const order = data?.order;

  async function act(action: "confirm" | "cancel") {
    if (action === "cancel" && !(await confirm("Cancel this order? We won't send it.", { title: "Cancel order", confirmLabel: "Yes, cancel it" }))) return;
    setError(null);
    setBusy(action);
    try {
      const res = await actOnSelfConfirm(code, action);
      queryClient.setQueryData(["self-confirm", code], res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong — please try again");
    } finally {
      setBusy(null);
    }
  }

  return (
    <StorefrontPage>
      <StorefrontPageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <PackageCheck size={14} aria-hidden="true" /> Your order
          </span>
        }
        title={loadError ? "Link not found" : order ? `Order ${order.orderNumber}` : "Your order"}
      />
      <div className="max-w-[28rem] rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-inset ring-line-subtle sm:p-7" data-testid="self-confirm">
        {isLoading && <p className="ui-delayed text-sm text-ink-500">Loading…</p>}
        {loadError && <p className="text-sm text-ink-500">This link isn&apos;t valid. Please check the link in your SMS, or contact us.</p>}
        {order && <OrderSummary order={order} />}
        {order?.canAct && (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-ink-700">Is everything right? Confirm and we&apos;ll send it — no call needed.</p>
            <Button className="w-full" size="lg" onClick={() => act("confirm")} disabled={busy !== null} data-testid="self-confirm-yes">
              {busy === "confirm" ? "Confirming…" : "Confirm order"}
            </Button>
            <Button className="w-full" variant="ghost" onClick={() => act("cancel")} disabled={busy !== null} data-testid="self-confirm-cancel">
              {busy === "cancel" ? "Cancelling…" : "Cancel order"}
            </Button>
            {error && (
              <p className="text-sm text-danger-600" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
        {order && !order.canAct && <Outcome status={order.status} />}
      </div>
      {dialog}
    </StorefrontPage>
  );
}

function OrderSummary({ order }: { order: SelfConfirmView }) {
  return (
    <div>
      <ul className="divide-y divide-line-subtle">
        {order.items.map((item, i) => (
          <li key={i} className="flex items-center gap-3 py-3 first:pt-0" data-testid="self-confirm-line">
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-ink-50">
              {item.imageUrl && <Image src={resolveImageUrl(item.imageUrl)} alt={item.name} fill sizes="56px" className="object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink-900">{item.name}</p>
              {item.variantLabel && <p className="truncate text-xs text-ink-500">{item.variantLabel}</p>}
            </div>
            <span className="shrink-0 text-sm text-ink-600">× {item.quantity}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-3 space-y-1.5 border-t border-line-subtle pt-3 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-500">Delivery to</dt>
          <dd className="text-right text-ink-900">{order.shippingArea}</dd>
        </div>
        <div className="flex justify-between gap-3 text-base">
          <dt className="text-ink-900">Total (cash on delivery)</dt>
          <dd className="font-semibold text-ink-900" data-testid="self-confirm-total">
            {formatPrice(order.total)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Outcome({ status }: { status: string }) {
  const text = doneText(status);
  const Icon = text.tone === "ok" ? CheckCircle2 : XCircle;
  return (
    <div className="mt-6 flex gap-3 rounded-xl bg-ink-50 p-4" data-testid="self-confirm-outcome" role="status">
      <Icon size={20} aria-hidden="true" className={text.tone === "ok" ? "mt-0.5 shrink-0 text-success-600" : "mt-0.5 shrink-0 text-ink-400"} />
      <div>
        <p className="text-sm font-medium text-ink-900">{text.title}</p>
        <p className="mt-0.5 text-sm text-ink-600">{text.body}</p>
        {status !== "CANCELLED" && (
          <Link href="/track-order" className="mt-2 inline-block text-sm text-ink-900 underline underline-offset-4">
            Track order
          </Link>
        )}
      </div>
    </div>
  );
}
