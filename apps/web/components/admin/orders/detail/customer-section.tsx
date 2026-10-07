"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, ExternalLink, MessageCircle, Pencil, Phone, User } from "lucide-react";
import {
  BD_ALL_AREA_OPTIONS,
  BD_ALL_DISTRICTS,
  BD_AREAS_BY_DISTRICT,
  BD_DIVISION_BY_DISTRICT,
  customerDetailsEditBlocker,
  toBdInternationalDigits,
  parseAreaDistrictOption,
  updateOrderDetailsSchema,
  type Order,
} from "@clothing-brand/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { copyToClipboard } from "@/lib/clipboard";
import { initials } from "@/lib/format";
import { DeliveryScoreBadge } from "../order-badges";
import type { OrderPermissions } from "../order-domain";
import { BlockedHint, DetailSection } from "./detail-section";
import type { OrderDetailCommands } from "./use-order-detail-commands";

interface Draft {
  customerName: string;
  customerPhone: string;
  shippingDistrict: string;
  shippingArea: string;
  shippingAddressLine: string;
}

function waLink(phone: string, message: string): string {
  return `https://wa.me/${toBdInternationalDigits(phone)}?text=${encodeURIComponent(message)}`;
}

/** 2 — who the order is for and where it goes; contact shortcuts; correcting name/phone/address before booking. */
/** `stacked`: one column regardless of viewport — for the narrow side column of the full page. */
export function CustomerSection({ order, detail, perms, stacked = false }: { order: Order; detail: OrderDetailCommands; perms: OrderPermissions; stacked?: boolean }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(null);
    setError(null);
  }, [order.id]);

  const blocker = customerDetailsEditBlocker(order);
  const fullAddress = `${order.shippingAddressLine}, ${order.shippingArea}, ${order.shippingDistrict}, ${order.shippingDivision}`;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${fullAddress}, Bangladesh`)}`;
  const areaOptions: readonly string[] = draft?.shippingDistrict ? (BD_AREAS_BY_DISTRICT[draft.shippingDistrict] ?? []) : BD_ALL_AREA_OPTIONS;

  function startEdit() {
    setError(null);
    setDraft({
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      shippingDistrict: order.shippingDistrict,
      shippingArea: order.shippingArea,
      shippingAddressLine: order.shippingAddressLine,
    });
  }

  function save() {
    if (!draft) return;
    // Same schema the API validates with — this only surfaces the first problem early.
    const parsed = updateOrderDetailsSchema
      .pick({ customerName: true, customerPhone: true, shippingDivision: true, shippingDistrict: true, shippingArea: true, shippingAddressLine: true })
      .safeParse({ ...draft, shippingDivision: BD_DIVISION_BY_DISTRICT[draft.shippingDistrict] });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the fields");
      return;
    }
    setError(null);
    detail.details.mutate(parsed.data, { onSuccess: () => setDraft(null) });
  }

  return (
    <DetailSection
      title="Customer & delivery address"
      icon={User}
      testId="order-customer"
      actions={
        perms.manage && !draft && !blocker ? (
          <Button variant="ghost" size="sm" onClick={startEdit}>
            <Pencil size={13} /> Edit
          </Button>
        ) : undefined
      }
    >
      {draft ? (
        <div className="space-y-3">
          <div className={stacked ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 gap-3 sm:grid-cols-2"}>
            <Field htmlFor="edit-customer-name" label="Name">
              <Input id="edit-customer-name" value={draft.customerName} onChange={(e) => setDraft({ ...draft, customerName: e.target.value })} />
            </Field>
            <Field htmlFor="edit-customer-phone" label="Phone">
              <Input id="edit-customer-phone" inputMode="tel" value={draft.customerPhone} onChange={(e) => setDraft({ ...draft, customerPhone: e.target.value })} />
            </Field>
            <Field htmlFor="edit-district" label="District">
              <SearchableSelect
                id="edit-district"
                value={draft.shippingDistrict}
                onChange={(v) => setDraft({ ...draft, shippingDistrict: v, shippingArea: "" })}
                options={BD_ALL_DISTRICTS}
                placeholder="Search district…"
              />
            </Field>
            <Field htmlFor="edit-area" label="Area / Thana">
              <SearchableSelect
                id="edit-area"
                value={draft.shippingArea}
                onChange={(v) => {
                  const p = parseAreaDistrictOption(v);
                  setDraft(p ? { ...draft, shippingDistrict: p.district, shippingArea: p.area } : { ...draft, shippingArea: v });
                }}
                options={areaOptions}
                placeholder="Search area…"
              />
            </Field>
          </div>
          <Field htmlFor="edit-address" label="House / road / details" error={error ?? undefined}>
            <Textarea id="edit-address" rows={2} value={draft.shippingAddressLine} onChange={(e) => setDraft({ ...draft, shippingAddressLine: e.target.value })} />
          </Field>
          <p className="text-xs text-ink-400">Changes are recorded on the order timeline.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" loading={detail.details.isPending} onClick={save}>
              Save changes
            </Button>
          </div>
        </div>
      ) : (
        <div className={stacked ? "grid grid-cols-1 gap-4" : "grid grid-cols-1 gap-4 sm:grid-cols-2"}>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-100 text-sm font-semibold text-ink-700" aria-hidden="true">
                {initials(order.customerName)}
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium text-ink-900">
                  {order.customerId ? (
                    <Link href={`/admin/customers/${order.customerId}`} className="hover:text-info-700 hover:underline">
                      {order.customerName}
                    </Link>
                  ) : (
                    order.customerName
                  )}
                </p>
                <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink-500">
                  {order.customerPhone}
                  <DeliveryScoreBadge score={order.deliveryScore} />
                </p>
                {order.customerEmail && <p className="truncate text-sm text-ink-500">{order.customerEmail}</p>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <a href={`tel:${order.customerPhone}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                <Phone size={13} /> Call
              </a>
              <a href={waLink(order.customerPhone, `Hi ${order.customerName.split(" ")[0]}, `)} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <MessageCircle size={13} /> WhatsApp
              </a>
              <IconButton variant="outline" aria-label="Copy phone number" onClick={() => copyToClipboard(order.customerPhone, "Phone number copied")}>
                <Copy size={14} />
              </IconButton>
            </div>
          </div>
          <div className="space-y-3">
            <address className="text-sm not-italic leading-relaxed text-ink-700">
              {order.shippingAddressLine}
              <br />
              {order.shippingArea}, {order.shippingDistrict}
              <br />
              {order.shippingDivision}
            </address>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(fullAddress, "Address copied")}>
                <Copy size={13} /> Copy address
              </Button>
              <a href={mapsUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <ExternalLink size={13} /> Maps
              </a>
            </div>
          </div>
          {perms.manage && blocker && !order.deletedAt && (
            // Span both tracks only in the two-column layout: in the stacked one a span conjures an implicit second column
            // and squeezes the customer and address blocks side by side.
            <div className={stacked ? undefined : "sm:col-span-2"}>
              <BlockedHint>Name and address are locked: {blocker.charAt(0).toLowerCase() + blocker.slice(1)}.</BlockedHint>
            </div>
          )}
        </div>
      )}
    </DetailSection>
  );
}
