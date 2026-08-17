"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Info, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShippingLabel } from "@/components/orders/shipping-label";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import * as settingsApi from "@/lib/api/settings";

const LABELS_PER_PAGE = 6;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export default function PrintLabelsPage() {
  const [ids, setIds] = useState<string[] | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(adminOrdersApi.PRINT_LABEL_ORDER_IDS_KEY);
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      setIds(Array.isArray(parsed) ? parsed : []);
    } catch {
      setIds([]);
    }
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-orders-bulk", ids],
    queryFn: () => adminOrdersApi.bulkGetOrders(ids!),
    enabled: Boolean(ids?.length),
  });
  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: settingsApi.getSettings });

  // Browsers suggest document.title as the default filename in the print dialog's "Save as PDF".
  // A plain useEffect setting it doesn't stick — Next's App Router re-renders the <title> tag from
  // the root layout's metadata on every render, clobbering a one-off assignment almost immediately.
  // Listening for the native `beforeprint` event instead means the title is set synchronously right
  // as the dialog opens (whether triggered by the Print button or the browser's own Ctrl+P), after
  // the last React render has already happened — and it's restored once the dialog closes so the
  // tab title doesn't stay changed for someone who never actually prints. The timestamp (not just
  // the date) means printing two different batches on the same day never suggests the same filename
  // twice, so a second save can't silently overwrite the first one.
  useEffect(() => {
    if (!data?.orders.length) return;
    const originalTitle = document.title;
    const setPrintTitle = () => {
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      const timeStr = now.toTimeString().slice(0, 5).replace(":", "-");
      document.title = `Shipping-Labels_${dateStr}_${timeStr}_${data.orders.length}orders`;
    };
    const restoreTitle = () => {
      document.title = originalTitle;
    };
    window.addEventListener("beforeprint", setPrintTitle);
    window.addEventListener("afterprint", restoreTitle);
    return () => {
      window.removeEventListener("beforeprint", setPrintTitle);
      window.removeEventListener("afterprint", restoreTitle);
    };
  }, [data?.orders.length]);

  if (ids === null || (ids.length > 0 && isLoading)) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-ink-400">
        <Loader2 size={28} className="animate-spin" />
        <p className="text-sm">Loading labels…</p>
      </div>
    );
  }

  if (ids.length === 0 || !data?.orders.length) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ink-100 text-ink-400">
          <Printer size={22} />
        </div>
        <p className="text-ink-500">No orders selected for printing.</p>
        <Link
          href="/admin/orders"
          className="inline-flex items-center gap-1 text-sm font-medium text-brass-600 hover:underline"
        >
          <ArrowLeft size={14} /> Back to Orders
        </Link>
      </div>
    );
  }

  const pages = chunk(data.orders, LABELS_PER_PAGE);

  return (
    <div className="min-h-screen bg-ink-50/60 print:bg-white">
      {/* top-14: this page lives inside the admin shell's own scroll container, whose global
          topbar is sticky top-0 z-20 h-14 — offset below it (same fix as orders/page.tsx and
          customers/page.tsx) so the two translucent bars don't collide and bleed through onto
          the scrolling label content. */}
      <div className="sticky top-14 z-10 border-b border-ink-200 bg-white/95 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4 sm:px-10">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/orders"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="font-display text-xl text-ink-900">Print Shipping Labels</h1>
              <p className="text-xs text-ink-500">
                {data.orders.length} label{data.orders.length === 1 ? "" : "s"} · {pages.length} page
                {pages.length === 1 ? "" : "s"} · 6 per sheet
              </p>
            </div>
          </div>
          <Button onClick={() => window.print()} variant="brass" size="sm">
            <Printer size={14} /> Print
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl p-6 sm:p-10 print:p-0">
        <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-ink-200 bg-white px-4 py-3 text-xs leading-relaxed text-ink-600 print:hidden">
          <Info size={15} className="mt-0.5 shrink-0 text-ink-400" />
          <p>
            In the print dialog: turn <strong className="text-ink-900">Background graphics</strong> on (so the
            COD stamp and shaded blocks stay), <strong className="text-ink-900">Headers and footers</strong> off
            (so the browser doesn&apos;t print a URL/date over the labels), and set{" "}
            <strong className="text-ink-900">Margins</strong> to &ldquo;Default&rdquo; or &ldquo;None&rdquo; — a
            custom margin can shrink the 2×3 grid off the page.
          </p>
        </div>

        <div className="space-y-8 print:space-y-0">
          {pages.map((pageOrders, i) => (
            <div key={i}>
              <p className="mb-2 text-center text-xs font-medium text-ink-400 print:hidden">
                Page {i + 1} of {pages.length}
              </p>
              <div className="print-page rounded-lg bg-white p-4 shadow-sm print:rounded-none print:p-0 print:shadow-none">
                {pageOrders.map((order) => (
                  <ShippingLabel key={order.id} order={order} store={settingsData?.settings} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
