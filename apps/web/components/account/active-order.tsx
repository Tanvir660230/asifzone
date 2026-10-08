"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Truck } from "lucide-react";
import type { AccountOrderCard } from "@clothing-brand/shared";
import { buttonVariants } from "@/components/ui/button";
import { ORDER_PROGRESS_STEPS, orderHeadline, orderProgressIndex } from "@/lib/account";
import { formatStoreDate } from "@/lib/format";
import { durations, easings } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { OrderThumb } from "./account-ui";

function itemsLine(order: AccountOrderCard): string {
  if (!order.firstItemName) return `${order.itemCount} ${order.itemCount === 1 ? "item" : "items"}`;
  const others = order.lineCount - 1;
  return others > 0 ? `${order.firstItemName} and ${others} more` : order.firstItemName;
}

/** The order on its way, told with its product photo: where it is now in plain words, a progress line, and what the
 * customer can do next. The line fills to the current step once on load. */
export function ActiveOrder({ order }: { order: AccountOrderCard }) {
  const { title, detail } = orderHeadline(order.status);
  const index = orderProgressIndex(order.status) ?? -1;
  const steps = ORDER_PROGRESS_STEPS.length;
  // The fill reaches the current step's marker; before confirmation it shows a sliver so the line reads as "started".
  const fill = index < 0 ? 0.04 : index / (steps - 1);

  return (
    <section
      aria-labelledby="active-order-title"
      data-testid="active-order"
      className="grid gap-6 rounded-3xl bg-surface p-3 shadow-sm ring-1 ring-inset ring-line-subtle sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:gap-8 lg:grid-cols-[minmax(0,14.5rem)_minmax(0,1fr)]"
    >
      <Link href={`/account/orders/${order.id}`} tabIndex={-1} aria-hidden="true" className="block">
        <OrderThumb
          imageUrl={order.imageUrl}
          alt=""
          sizes="(min-width: 1024px) 232px, (min-width: 640px) 240px, 100vw"
          className="aspect-[4/3] w-full rounded-2xl sm:aspect-[4/5]"
        />
      </Link>

      <div className="flex min-w-0 flex-col px-3 pb-4 sm:px-0 sm:py-5 sm:pr-6">
        <p className="text-sm text-fg-muted">
          Order {order.orderNumber}, placed {formatStoreDate(order.createdAt, { day: "numeric", month: "long" })}
        </p>
        <h2 id="active-order-title" className="mt-2 text-balance font-display text-[1.75rem] leading-tight tracking-tight text-fg sm:text-[2rem]">
          {title}
        </h2>
        <p className="mt-2 text-[15px] text-ink-600">
          {detail} <span className="text-fg-muted">{itemsLine(order)}.</span>
        </p>

        <div className="mt-8" role="img" aria-label={`Progress: ${index < 0 ? "not confirmed yet" : `${ORDER_PROGRESS_STEPS[index]!.label}, step ${index + 1} of ${steps}`}`}>
          <div className="relative h-0.5 rounded-full bg-line">
            <motion.div
              className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-accent"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: fill }}
              transition={{ duration: durations.slower * 1.6, ease: easings.smooth, delay: 0.2 }}
            />
            {ORDER_PROGRESS_STEPS.map((step, i) => (
              <span
                key={step.status}
                className={cn(
                  "absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface",
                  i <= index ? "bg-accent" : "bg-line-strong",
                )}
                style={{ left: `${(i / (steps - 1)) * 100}%` }}
              />
            ))}
          </div>
          <div className="mt-3 flex justify-between text-xs sm:text-[13px]">
            {ORDER_PROGRESS_STEPS.map((step, i) => (
              <span
                key={step.status}
                className={cn(
                  // Small screens keep the first, current and last labels only.
                  i === index ? "font-semibold text-fg" : i < index ? "text-fg" : "text-fg-subtle",
                  i !== 0 && i !== steps - 1 && i !== index && "hidden sm:inline",
                )}
              >
                {step.label}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-3 sm:mt-auto sm:pt-8">
          <Link href={`/account/orders/${order.id}`} className={buttonVariants({ size: "lg", className: "flex-1 sm:flex-none" })}>
            View order
          </Link>
          {order.courierTrackingLink && order.status === "SHIPPED" && (
            <a
              href={order.courierTrackingLink}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "secondary", size: "lg", className: "flex-1 sm:flex-none" })}
            >
              <Truck size={16} aria-hidden="true" /> Track parcel
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

/** Shown instead of an active order to someone who hasn't ordered yet — an invitation, not an empty box. */
export function FirstOrderWelcome() {
  return (
    <section
      aria-labelledby="welcome-title"
      className="relative overflow-hidden rounded-3xl bg-surface px-6 py-10 shadow-sm ring-1 ring-inset ring-line-subtle sm:px-10 sm:py-14"
    >
      <h2 id="welcome-title" className="max-w-md font-display text-[1.75rem] leading-tight tracking-tight text-fg sm:text-[2rem]">
        Your first order will show up here
      </h2>
      <p className="mt-3 max-w-md text-[15px] text-ink-600">
        Follow it from confirmation to your door, and find everything you&rsquo;ve bought, saved and earned on this page.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/search" className={buttonVariants({ size: "lg" })}>
          Start shopping
        </Link>
        <Link href="/account/saved" className={buttonVariants({ variant: "secondary", size: "lg" })}>
          See saved items
        </Link>
      </div>
    </section>
  );
}
