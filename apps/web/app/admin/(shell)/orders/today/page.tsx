"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, ClipboardList, PackageCheck, PackageOpen, PhoneCall, ScanLine, Tag, Truck } from "lucide-react";
import {
  EXCEPTION_CENTER_IDS,
  OPERATIONS_STAGES,
  ORDER_EXCEPTION_INFO,
  type OperationsItemRef,
  type OperationsStageId,
  type OrderExceptionId,
} from "@clothing-brand/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { orderKeys } from "@/components/admin/orders/order-domain";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import { getErrorMessage } from "@/lib/api-client";
import { formatCount, formatStoreTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** How long ago, in the unit a person thinks in: minutes, hours, then days. */
function age(iso: string | null): string | null {
  if (!iso) return null;
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} d`;
}

function hrefFor(ref: OperationsItemRef): string {
  return "queue" in ref ? `/admin/orders?queue=${ref.queue}` : `/admin/orders?f.exception=${ref.exception}`;
}

/** Each step's one shortcut — where the work is actually done, not another list to read. */
const STAGE_ACTION: Record<OperationsStageId, { label: string; href?: string; icon: typeof ArrowRight; hint: string }> = {
  confirm: { label: "Call next", icon: PhoneCall, hint: "Opens the next customer to call, with the call buttons." },
  prepare: { label: "Open", href: "/admin/orders?queue=readyToBook", icon: Truck, hint: "Select all, then Book courier and Pick list." },
  dispatch: { label: "Open", href: "/admin/orders?queue=handoverPending", icon: PackageCheck, hint: "Select what the rider took, then “Rider took these” — or scan them." },
  delivery: { label: "Open", href: "/admin/orders?queue=stuckInTransit", icon: ArrowRight, hint: "Call the customer or check the parcel in Steadfast." },
  returns: { label: "Receive", href: "/admin/orders/returns-in", icon: PackageOpen, hint: "Scan the parcel, say what came back, confirm." },
};

/**
 * Today (docs/WAREHOUSE_OPERATIONS.md §5): the day's order work as one short list in the order it happens — call, book,
 * hand over, with the courier, returns — each with its count and the one shortcut that does it. Zeros stay quiet. Below,
 * the Exception Center: facts that disagree. Every number is the server's count of exactly the list it opens.
 */
export default function TodayOperationsPage() {
  const router = useRouter();
  const stats = useQuery({ queryKey: orderKeys.stats, queryFn: adminOrdersApi.getOrderStats, refetchInterval: 60_000 });
  const board = useQuery({ queryKey: [...orderKeys.stats, "exceptions"], queryFn: ({ signal }) => adminOrdersApi.getOrderExceptions({ signal }), refetchInterval: 60_000 });
  const [calling, setCalling] = useState(false);

  const count = (ref: OperationsItemRef): number => ("queue" in ref ? stats.data?.queueCounts?.[ref.queue] : board.data?.exceptions[ref.exception]?.count) ?? 0;
  const loading = stats.isLoading || board.isLoading;
  const failed = stats.isError || board.isError;
  const open = EXCEPTION_CENTER_IDS.filter((id) => (board.data?.exceptions[id]?.count ?? 0) > 0);

  async function callNext() {
    setCalling(true);
    try {
      const { next } = await adminOrdersApi.takeNextConfirmation();
      if (next) router.push(`/admin/orders/${next.orderId}`);
      else toast.info("Nobody is waiting for a call right now");
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't take the next call"));
    } finally {
      setCalling(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Today"
        description={board.data ? `Your order work, in order. Updated ${formatStoreTime(board.data.generatedAt)}.` : "Your order work, in order."}
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/orders/dispatch" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <ScanLine size={14} /> Dispatch scan
            </Link>
            <Link href="/admin/orders/product-labels" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Tag size={14} /> Labels
            </Link>
          </div>
        }
      />
      <ModuleTabs />

      {failed ? (
        <ErrorState
          description="Today's counts didn't load. The orders list still works."
          onRetry={() => {
            void stats.refetch();
            void board.refetch();
          }}
        />
      ) : (
        <>
          <Card className="divide-y divide-line-subtle overflow-hidden p-0">
            {OPERATIONS_STAGES.map((stage, i) => {
              const main = count(stage.primary);
              const extras = stage.more.map((m) => ({ ...m, n: count(m) })).filter((m) => m.n > 0);
              const idle = !loading && main === 0 && extras.length === 0;
              const action = STAGE_ACTION[stage.id];
              return (
                <section key={stage.id} aria-label={stage.label} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-6">
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium tabular-nums",
                      idle ? "bg-success-100 text-success-700" : "bg-ink-900/[0.06] text-fg",
                    )}
                    aria-hidden="true"
                  >
                    {idle ? <Check size={15} /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{stage.label}</p>
                    {loading ? (
                      <Skeleton className="mt-1 h-6 w-40" />
                    ) : idle ? (
                      <p className="mt-0.5 text-fg-muted">Nothing waiting</p>
                    ) : (
                      <Link href={hrefFor(stage.primary)} className="mt-0.5 block text-fg hover:underline">
                        <span className="font-display text-2xl tabular-nums tracking-tight">{formatCount(main)}</span> <span className="text-fg-muted">{stage.primary.label}</span>
                      </Link>
                    )}
                    {extras.length > 0 && (
                      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                        {extras.map((m) => (
                          <Link key={"queue" in m ? m.queue : m.exception} href={hrefFor(m)} className={cn("hover:underline", "exception" in m ? "text-warning-700" : "text-fg-muted")}>
                            <span className="tabular-nums">{formatCount(m.n)}</span> {m.label}
                          </Link>
                        ))}
                      </p>
                    )}
                    {!idle && !loading && <p className="mt-1 hidden text-xs text-fg-subtle sm:block">{action.hint}</p>}
                  </div>
                  {!idle && !loading &&
                    (stage.id === "confirm" ? (
                      <Button size="sm" loading={calling} disabled={main === 0} onClick={callNext} className="w-full sm:w-auto">
                        <action.icon size={14} /> {action.label}
                      </Button>
                    ) : (
                      // Open goes where the work is: the stage's main list, or — when that is empty — the first list with something in it.
                      <Link
                        href={main === 0 && extras[0] && stage.id !== "returns" ? hrefFor(extras[0]) : action.href!}
                        className={cn(buttonVariants({ size: "sm", variant: "outline" }), "w-full sm:w-auto")}
                      >
                        <action.icon size={14} /> {action.label}
                      </Link>
                    ))}
                </section>
              );
            })}
          </Card>

          <section aria-labelledby="exceptions-title" className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="exceptions-title" className="font-display text-lg tracking-tight text-fg">
                Things that don&apos;t add up
              </h2>
              {board.data && open.length > 0 && <p className="text-sm text-fg-subtle">{open.length} to look at</p>}
            </div>
            <Card className="divide-y divide-line-subtle overflow-hidden p-0">
              {loading && (
                <div className="p-4">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="mt-2 h-3 w-2/3" />
                </div>
              )}
              {!loading && open.length === 0 && (
                <div className="flex items-center gap-3 p-4 text-sm text-fg-muted">
                  <Check size={18} className="text-success-600" aria-hidden="true" />
                  Order, courier and stock records agree.
                </div>
              )}
              {open.map((id) => (
                <ExceptionRow key={id} id={id} count={board.data!.exceptions[id]!.count} oldestAt={board.data!.exceptions[id]!.oldestAt} />
              ))}
            </Card>
          </section>

          <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
            <ClipboardList size={13} aria-hidden="true" /> Picking several orders? Select them on the list and choose Pick list.
          </p>
        </>
      )}
    </div>
  );
}

function ExceptionRow({ id, count, oldestAt }: { id: OrderExceptionId; count: number; oldestAt: string | null }) {
  const info = ORDER_EXCEPTION_INFO[id];
  const oldest = age(oldestAt);
  return (
    <Link href={`/admin/orders?f.exception=${id}`} className="group flex items-start gap-4 p-4 hover:bg-ink-900/[0.03] focus-visible:bg-ink-900/[0.03] focus-visible:outline-none sm:px-6">
      <span className="mt-0.5 min-w-[2.5rem] text-right font-display text-xl tabular-nums tracking-tight text-fg">{formatCount(count)}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-fg">{info.label}</span>
          {oldest && <span className="text-xs text-fg-subtle">oldest {oldest}</span>}
        </span>
        <span className="mt-0.5 block text-sm text-fg">{info.action}</span>
      </span>
      <ArrowRight size={16} className="mt-1 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}
