import { businessDate } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { getTimezone } from "../../domain/config/commerce-settings";
import { syncCourierPayouts } from "../../domain/shipments/courier-evidence";
import { notify } from "../../lib/notify";
import { captureError } from "../../lib/observability/error-capture";
import { orderWhereContext } from "../orders/order.service";
import { parcelQueueWhere } from "../orders/parcel-queues";

/**
 * The daily courier check (Order Operations plan, phase 5). Built only on what is verified: our own order facts and the
 * live-checked payments endpoints behind syncCourierPayouts. It counts what needs a person — parcels stuck in transit,
 * returns the courier reported that haven't arrived, today's bookings not yet scanned out — runs the payout evidence sync
 * (courier cost facts on the shipment legs; charges become proven or flagged for review, nothing is posted), records the
 * run and drops one alert in the admin bell per day.
 *
 * It never writes stock, money, journals or an order's status, and never treats a courier status as proof of cash or of a
 * parcel in hand — those stay with a person (guard test: courier-automation.integration.test.ts).
 */

export interface CourierAutomationSummary {
  day: string;
  outcome: "OK" | "PARTIAL" | "FAILED" | "RUNNING";
  stuckInTransit: number;
  returnOverdue: number;
  handoverPending: number;
  payoutsChecked: number;
  payoutProblems: number;
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
}

async function countQueues() {
  const ctx = await orderWhereContext();
  const count = (q: "stuckInTransit" | "returnOverdue" | "handoverPending") => prisma.order.count({ where: { deletedAt: null, ...parcelQueueWhere(q, ctx.now, ctx.parcel) } });
  const [stuckInTransit, returnOverdue, handoverPending] = await Promise.all([count("stuckInTransit"), count("returnOverdue"), count("handoverPending")]);
  return { stuckInTransit, returnOverdue, handoverPending };
}

/** Run the check now (the daily job, or an owner's "run now"). Idempotent per store day: a rerun updates the day's row
 * and the bell alert goes out once. `payouts: false` skips the courier call (tests, or when the courier is unreachable). */
export async function runCourierAutomation(opts: { payouts?: boolean; now?: Date } = {}): Promise<CourierAutomationSummary> {
  const now = opts.now ?? new Date();
  const day = businessDate(now, await getTimezone());
  const run = await prisma.courierAutomationRun.upsert({
    where: { day },
    create: { day, startedAt: now },
    update: { startedAt: now, finishedAt: null, outcome: "RUNNING", message: null },
  });

  const notes: string[] = [];
  let outcome: "OK" | "PARTIAL" | "FAILED" = "OK";
  let counts = { stuckInTransit: 0, returnOverdue: 0, handoverPending: 0 };
  let payoutsChecked = 0;
  let payoutProblems = 0;

  try {
    counts = await countQueues();
  } catch (err) {
    outcome = "FAILED";
    notes.push("Couldn't count the parcel queues");
    captureError(err, { msg: "[courier-automation] queue counts failed" });
  }

  if (opts.payouts !== false) {
    try {
      const sync = await syncCourierPayouts();
      payoutsChecked = sync.payouts;
      payoutProblems = sync.problems.length;
      if (payoutProblems) {
        outcome = outcome === "FAILED" ? "FAILED" : "PARTIAL";
        notes.push(`${payoutProblems} payout(s) couldn't be read`);
      }
    } catch (err) {
      outcome = outcome === "FAILED" ? "FAILED" : "PARTIAL";
      // The technical detail goes to the error log; the operators see what it means.
      captureError(err, { msg: "[courier-automation] payout sync failed" });
      notes.push("Couldn't reach the courier to check payouts — will try again tomorrow");
    }
  }

  const finished = await prisma.courierAutomationRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), outcome, ...counts, payoutsChecked, payoutProblems, message: notes.join(" · ") || null },
  });

  // One alert a day, only when there is something to act on.
  const attention = counts.stuckInTransit + counts.returnOverdue;
  if (attention > 0 && !finished.notifiedAt) {
    const { count } = await prisma.courierAutomationRun.updateMany({ where: { id: run.id, notifiedAt: null }, data: { notifiedAt: new Date() } });
    if (count === 1) {
      const parts = [
        counts.stuckInTransit ? `${counts.stuckInTransit} parcel(s) stuck in transit` : "",
        counts.returnOverdue ? `${counts.returnOverdue} return(s) not back yet` : "",
      ].filter(Boolean);
      notify({
        type: "courier.attention",
        title: "Parcels need a look",
        body: `${parts.join(" · ")}. Nothing was changed — check them with the courier.`,
        link: `/admin/orders?f.queue=${counts.stuckInTransit ? "stuckInTransit" : "returnOverdue"}`,
      });
    }
  }
  return toSummary(await prisma.courierAutomationRun.findUniqueOrThrow({ where: { id: run.id } }));
}

export async function latestCourierAutomation(): Promise<CourierAutomationSummary | null> {
  const run = await prisma.courierAutomationRun.findFirst({ orderBy: { startedAt: "desc" } });
  return run ? toSummary(run) : null;
}

function toSummary(r: Awaited<ReturnType<typeof prisma.courierAutomationRun.findUniqueOrThrow>>): CourierAutomationSummary {
  return {
    day: r.day,
    outcome: r.outcome as CourierAutomationSummary["outcome"],
    stuckInTransit: r.stuckInTransit,
    returnOverdue: r.returnOverdue,
    handoverPending: r.handoverPending,
    payoutsChecked: r.payoutsChecked,
    payoutProblems: r.payoutProblems,
    message: r.message,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}
