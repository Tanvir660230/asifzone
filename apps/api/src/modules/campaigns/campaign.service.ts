import { currentCorrelationId } from "../../lib/observability/context";
import type { Customer, Campaign } from "@prisma/client";
import type { CampaignListQuery, CreateCampaignInput, SegmentType, UpdateCampaignInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";
import { createQueue } from "../../lib/queue";
import { mapWithConcurrency } from "../../lib/concurrency";
import { renderEmailLayout, emailLink } from "../../lib/email-template";
import { generateEmailUnsubscribeToken } from "../customers/customer.service";
import { captureError } from "../../lib/observability/error-capture";
import { getProviders } from "../../providers/registry";

/** Every SMS a customer receives — bulk campaign or a one-off admin message (see
 * customer.service.ts's sendAdHocSmsToCustomer) — is recorded as a Campaign + CampaignRecipient
 * pair. That's what lets a customer's SMS history/"last SMS sent" be a plain CampaignRecipient
 * query instead of needing a separate log model. */
export const CAMPAIGN_SEND_QUEUE = "campaign-send";

const NO_ORDER_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
// How many recipients are dispatched concurrently per campaign — bounded so a large campaign
// doesn't open thousands of simultaneous outbound connections to the mail/SMS/push provider, but
// high enough that sends aren't effectively serial like the old one-at-a-time loop was.
const SEND_CONCURRENCY = 10;

/** Human-readable label per SegmentType, used to name the Segment row a campaign creates. */
const SEGMENT_LABELS: Record<SegmentType, string> = {
  ALL_CUSTOMERS: "All customers",
  NEWSLETTER_SUBSCRIBERS: "Newsletter subscribers",
  CUSTOMERS_WITH_ORDERS: "Customers with at least one order",
  CUSTOMERS_NO_ORDER_30D: "No order in the last 30 days",
  WIN_BACK: "Bought before, quiet for 60 days",
  REPEAT_BUYERS: "Repeat buyers (2+ delivered)",
  SECOND_ORDER_NUDGE: "One order 14–60 days ago, none since",
};

const DAY_MS = 86_400_000;
/** "Bought" in the retention audiences: the parcel reached the customer (fully or in part). */
const BOUGHT = { status: { in: ["DELIVERED", "PARTIALLY_DELIVERED"] as Array<"DELIVERED" | "PARTIALLY_DELIVERED"> }, deletedAt: null };

/** Customers with at least `min` (and at most `max`) delivered orders; with `placed`, only orders placed in that window. */
async function customersByBought(min: number, max: number | null, placed?: { gte?: Date; lte?: Date }) {
  const groups = await prisma.order.groupBy({
    by: ["customerId"],
    where: { ...BOUGHT, customerId: { not: null }, ...(placed ? { createdAt: placed } : {}) },
    _count: { _all: true },
  });
  return groups.filter((g) => g._count._all >= min && (max === null || g._count._all <= max)).map((g) => g.customerId!);
}

/** Every segment type maps to a Customer account — a guest-only newsletter subscriber (email with
 * no Customer row) can't be a CampaignRecipient, since that FK requires a real customerId. */
export async function resolveSegmentCustomers(type: SegmentType): Promise<Customer[]> {
  switch (type) {
    case "ALL_CUSTOMERS":
      return prisma.customer.findMany();
    case "NEWSLETTER_SUBSCRIBERS": {
      const subs = await prisma.newsletterSubscriber.findMany({ select: { email: true } });
      if (!subs.length) return [];
      return prisma.customer.findMany({ where: { email: { in: subs.map((s) => s.email) } } });
    }
    case "CUSTOMERS_WITH_ORDERS":
      return prisma.customer.findMany({ where: { orders: { some: {} } } });
    case "CUSTOMERS_NO_ORDER_30D": {
      const cutoff = new Date(Date.now() - NO_ORDER_WINDOW_MS);
      return prisma.customer.findMany({ where: { orders: { none: { createdAt: { gt: cutoff } } } } });
    }
    case "WIN_BACK": {
      const quietSince = new Date(Date.now() - 60 * DAY_MS);
      return prisma.customer.findMany({
        where: { AND: [{ orders: { some: BOUGHT } }, { orders: { none: { createdAt: { gt: quietSince }, deletedAt: null } } }] },
      });
    }
    case "REPEAT_BUYERS": {
      const ids = await customersByBought(2, null);
      return ids.length ? prisma.customer.findMany({ where: { id: { in: ids } } }) : [];
    }
    case "SECOND_ORDER_NUDGE": {
      const now = Date.now();
      const exactlyOne = new Set(await customersByBought(1, 1));
      const inWindow = (await customersByBought(1, 1, { gte: new Date(now - 60 * DAY_MS), lte: new Date(now - 14 * DAY_MS) })).filter((id) => exactlyOne.has(id));
      if (!inWindow.length) return [];
      // ...and nothing ordered since (any status) in the last 14 days.
      return prisma.customer.findMany({ where: { id: { in: inWindow }, orders: { none: { createdAt: { gt: new Date(now - 14 * DAY_MS) }, deletedAt: null } } } });
    }
  }
}

/** Who a campaign would reach: the segment's customers, and how many of them the channel may contact — SMS and email need
 * the customer's marketing consent and a number / address, push a subscription (the same rules dispatch applies). */
export async function campaignAudience(type: SegmentType, channel: "EMAIL" | "SMS" | "PUSH") {
  const people = await resolveSegmentCustomers(type);
  let reachableIds: string[];
  if (channel === "SMS") reachableIds = people.filter((c) => c.phone && c.smsMarketingOptIn).map((c) => c.id);
  else if (channel === "EMAIL") reachableIds = people.filter((c) => c.email && c.emailMarketingOptIn).map((c) => c.id);
  else {
    const subs = people.length ? await prisma.pushSubscription.findMany({ where: { customerId: { in: people.map((c) => c.id) } }, select: { customerId: true } }) : [];
    const withSub = new Set(subs.map((sub) => sub.customerId));
    reachableIds = people.filter((c) => withSub.has(c.id)).map((c) => c.id);
  }
  return { customers: people.length, reachable: reachableIds.length, reachableIds };
}

async function dispatchToRecipient(campaign: Campaign, customer: Customer): Promise<void> {
  const title = campaign.subject ?? campaign.name;
  switch (campaign.channel) {
    case "EMAIL": {
      if (!customer.email) throw new Error("Customer has no email on file");
      if (!customer.emailMarketingOptIn) throw new Error("Customer has not opted in to email marketing");
      const unsubscribeUrl = `${env.webOrigin}/account/unsubscribe?customerId=${customer.id}&token=${generateEmailUnsubscribeToken(customer.id)}`;
      await getProviders().email.send({
        to: customer.email,
        subject: title,
        html: await renderEmailLayout({
          bodyHtml: campaign.body,
          footerHtml: `Don't want these emails? ${emailLink(unsubscribeUrl, "Unsubscribe")}`,
        }),
      });
      return;
    }
    case "SMS":
      if (!customer.phone) throw new Error("Customer has no phone number on file");
      if (!customer.smsMarketingOptIn) throw new Error("Customer has not opted in to SMS marketing");
      await getProviders().sms.send({ to: customer.phone, body: campaign.body });
      return;
    case "PUSH": {
      const subscriptions = await prisma.pushSubscription.findMany({ where: { customerId: customer.id } });
      if (!subscriptions.length) throw new Error("Customer has no push subscription");
      await Promise.all(
        subscriptions.map((s) => getProviders().push.send({ subscription: s, title, body: campaign.body })),
      );
      return;
    }
  }
}

// --- admin CRUD ---

export async function listCampaigns(query: CampaignListQuery) {
  const where = query.status ? { status: query.status } : {};

  const { items, ...rest } = await paginate(
    query,
    (p) =>
      prisma.campaign.findMany({
        where,
        include: { segment: true, _count: { select: { recipients: true } } },
        orderBy: { createdAt: "desc" },
        ...p,
      }),
    () => prisma.campaign.count({ where }),
  );

  return {
    items: items.map(({ _count, ...campaign }) => ({ ...campaign, recipientCount: _count.recipients })),
    ...rest,
  };
}

export async function getCampaignById(id: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: { segment: true, _count: { select: { recipients: true } } },
  });
  if (!campaign) throw AppError.notFound("Campaign not found");

  const grouped = await prisma.campaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId: id },
    _count: true,
  });
  const recipientCounts = { PENDING: 0, SENT: 0, FAILED: 0 };
  for (const row of grouped) recipientCounts[row.status] = row._count;

  const { _count, ...rest } = campaign;
  return { ...rest, recipientCount: _count.recipients, recipientCounts };
}

export async function createCampaign(input: CreateCampaignInput) {
  const segment = await prisma.segment.create({
    data: {
      name: `${input.name} — ${SEGMENT_LABELS[input.segmentType]}`,
      filter: { type: input.segmentType },
    },
  });

  return prisma.campaign.create({
    data: {
      name: input.name,
      channel: input.channel,
      subject: input.subject ?? null,
      body: input.body,
      segmentId: segment.id,
      scheduledAt: input.scheduledAt ?? null,
      status: input.scheduledAt ? "SCHEDULED" : "DRAFT",
    },
    include: { segment: true },
  });
}

async function getEditableCampaign(id: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw AppError.notFound("Campaign not found");
  if (campaign.status !== "DRAFT") throw AppError.badRequest("Only draft campaigns can be edited");
  return campaign;
}

export async function updateCampaign(id: string, input: UpdateCampaignInput) {
  const campaign = await getEditableCampaign(id);

  let newSegmentId: string | undefined;
  if (input.segmentType) {
    const segment = await prisma.segment.create({
      data: {
        name: `${input.name ?? campaign.name} — ${SEGMENT_LABELS[input.segmentType]}`,
        filter: { type: input.segmentType },
      },
    });
    newSegmentId = segment.id;
  }

  // One write, not two — the campaign never sits in a state where its content and its segment
  // were changed by two separate, non-transactional updates (a crash between them used to be able
  // to leave a new segment attached to stale content, or vice versa).
  const updated = await prisma.campaign.update({
    where: { id },
    data: {
      name: input.name,
      channel: input.channel,
      subject: input.subject,
      body: input.body,
      ...(newSegmentId ? { segmentId: newSegmentId } : {}),
    },
    include: { segment: true },
  });

  // The old Segment row is now orphaned — every campaign gets its own dedicated Segment (see
  // createCampaign and above), nothing else ever attaches an existing one, so once this campaign
  // stops pointing at it, it's unreachable. Clean it up rather than letting Segment rows
  // accumulate forever; the reference-count check is just defensive in case that ever changes.
  if (newSegmentId && campaign.segmentId && campaign.segmentId !== newSegmentId) {
    const stillReferenced = await prisma.campaign.count({ where: { segmentId: campaign.segmentId } });
    if (stillReferenced === 0) {
      await prisma.segment.delete({ where: { id: campaign.segmentId } }).catch(() => {});
    }
  }

  return updated;
}

export async function deleteCampaign(id: string) {
  await getEditableCampaign(id);
  await prisma.campaign.delete({ where: { id } });
}

// --- scheduling & sending ---

export async function scheduleCampaign(id: string, scheduledAt: Date) {
  await getEditableCampaign(id);
  if (scheduledAt.getTime() <= Date.now()) throw AppError.badRequest("Scheduled time must be in the future");
  return prisma.campaign.update({ where: { id }, data: { status: "SCHEDULED", scheduledAt } });
}

export async function cancelSchedule(id: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw AppError.notFound("Campaign not found");
  if (campaign.status !== "SCHEDULED") throw AppError.badRequest("Campaign is not scheduled");
  return prisma.campaign.update({ where: { id }, data: { status: "DRAFT", scheduledAt: null } });
}

/** Resolves the audience, creates a CampaignRecipient row per matched customer, flips the
 * campaign to SENDING, and enqueues the actual send — called both by "send now" and by
 * campaign-scheduler-cron.ts once a SCHEDULED campaign's time arrives. */
export async function queueCampaignSend(id: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id }, include: { segment: true } });
  if (!campaign) throw AppError.notFound("Campaign not found");
  if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") {
    throw AppError.badRequest("Campaign has already been sent or is sending");
  }
  if (!campaign.segment) throw AppError.badRequest("Campaign has no audience segment");

  const filter = campaign.segment.filter as { type: SegmentType };
  const customers = await resolveSegmentCustomers(filter.type);
  if (!customers.length) throw AppError.badRequest("No customers match this campaign's audience");

  await prisma.$transaction([
    prisma.campaign.update({ where: { id }, data: { status: "SENDING" } }),
    prisma.campaignRecipient.createMany({
      data: customers.map((c) => ({ campaignId: id, customerId: c.id })),
      skipDuplicates: true,
    }),
  ]);

  const queue = createQueue(CAMPAIGN_SEND_QUEUE);
  // Phase 11: the send job inherits the request's correlation ID (observability only).
  await queue.add("send", { campaignId: id, correlationId: currentCorrelationId() });
}

/** The actual send loop, run by the campaign-send worker. Each recipient's outcome is recorded
 * independently, so a partial failure never re-sends to customers who already succeeded. */
export async function processCampaignSend(campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return;

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "PENDING" },
    include: { customer: true },
  });

  await mapWithConcurrency(recipients, SEND_CONCURRENCY, async (recipient) => {
    try {
      await dispatchToRecipient(campaign, recipient.customer);
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "SENT", sentAt: new Date() },
      });
    } catch (err) {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "FAILED", error: err instanceof Error ? err.message : "Unknown error" },
      });
    }
  });

  const [pending, sent] = await Promise.all([
    prisma.campaignRecipient.count({ where: { campaignId, status: "PENDING" } }),
    prisma.campaignRecipient.count({ where: { campaignId, status: "SENT" } }),
  ]);
  if (pending === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: sent > 0 ? "SENT" : "FAILED", sentAt: new Date() },
    });
  }
}

/** Called every minute by campaign-scheduler-cron.ts — promotes any SCHEDULED campaign whose
 * time has arrived into the send queue. */
export async function promoteDueCampaigns(): Promise<number> {
  const due = await prisma.campaign.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    select: { id: true },
  });
  for (const { id } of due) {
    await queueCampaignSend(id).catch((err) => captureError(err, { msg: `[campaign-scheduler] failed to promote ${id}:` }));
  }
  return due.length;
}
